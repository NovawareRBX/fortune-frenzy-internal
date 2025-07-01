use axum::{extract::Query, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::{env, net::SocketAddr, time::Instant};
use tokio::net::TcpListener;
use tokio_postgres::NoTls;
use rust_decimal::Decimal;
use tracing::{info};
use rayon::prelude::*;
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::collections::HashMap;

const TOP_N: usize = 50;
const MAX_TOP_N: usize = TOP_N;

static PG_POOL: Lazy<Pool> = Lazy::new(|| {
    let user = env::var("FF_POSTGRES_USER").unwrap();
    let password = env::var("FF_POSTGRES_PASSWORD").unwrap();
    let mut cfg = tokio_postgres::Config::new();
    cfg.host("pgbouncer").port(6432).user(&user).password(&password).dbname("fortunefrenzy");
    let mgr_config = ManagerConfig { recycling_method: RecyclingMethod::Fast };
    let mgr = Manager::from_config(cfg, NoTls, mgr_config);
    Pool::builder(mgr).max_size(16).build().unwrap()
});

#[derive(Deserialize)]
struct ItemRangeQuery {
    user_id: String,
    #[serde(rename = "minValue")] min_value: i64,
    #[serde(rename = "maxValue")] max_value: i64,
    #[serde(rename = "maxItems")] max_items: u8,
    #[serde(rename = "minItems")] min_items: u8,
}

struct InventoryItem {
    item_id: i64,
    value: i64,
    qty: u8,
}

struct ComboMeta {
    value: i64,
    count: u8,
    counts: [u8; MAX_TOP_N],
}

async fn process_request(q: ItemRangeQuery) -> anyhow::Result<HashMap<i64, u8>> {
    let start = Instant::now();
    info!(user_id = %q.user_id, min_value = q.min_value, max_value = q.max_value, max_items = q.max_items, min_items = q.min_items, "Processing request");
    let user_id: Decimal = q.user_id.parse()?;
    let client = PG_POOL.get().await?;

    let rows = client
        .query(
            "SELECT ic.item_id::bigint,
                    COUNT(*),
                    i.value::bigint
             FROM item_copies ic
             JOIN items i ON i.id = ic.item_id
             WHERE ic.owner_id = $1 AND i.value::bigint <= $2
             GROUP BY ic.item_id, i.value
             ORDER BY i.value DESC",
            &[&user_id, &q.max_value],
        )
        .await?;

    let mut items: Vec<InventoryItem> = Vec::with_capacity(rows.len());
    for row in rows {
        let item_id: i64 = row.get(0);
        let qty: i64 = row.get(1);
        let value: i64 = row.get(2);
        items.push(InventoryItem { item_id, value, qty: qty as u8 });
    }
    items.sort_unstable_by_key(|i| -i.value);
    info!(total_items = items.len(), "Fetched and prepared inventory items");

    let top_n = items.len().min(TOP_N);
    let (top_items, leftover) = items.split_at(top_n);
    let mut leftover_prefix: Vec<i64> = Vec::with_capacity(leftover.iter().map(|it| it.qty as usize).sum::<usize>() + 1);
    leftover_prefix.push(0);
    for item in leftover {
        for _ in 0..item.qty {
            let last = *leftover_prefix.last().unwrap();
            leftover_prefix.push(last + item.value);
        }
    }

    let total_leftover_copies = leftover_prefix.len() - 1;

    fn enumerate_combos(
        items: &[InventoryItem], max_value: i64, max_items: u8,
    ) -> Vec<ComboMeta> {
        let mut combos = Vec::with_capacity(10_000);
        struct Frame { idx: usize, val: i64, cnt: u8, counts: [u8; MAX_TOP_N] }
        let mut stack = Vec::with_capacity(10_000);
        stack.push(Frame { idx: 0, val: 0, cnt: 0, counts: [0; MAX_TOP_N] });

        while let Some(frame) = stack.pop() {
            if frame.idx == items.len() {
                combos.push(ComboMeta { value: frame.val, count: frame.cnt, counts: frame.counts });
            } else {
                let item = &items[frame.idx];
                let max_take = if item.value == 0 {
                    ((max_items - frame.cnt) as i64)
                        .min(item.qty as i64) as u8
                } else {
                    ((max_value - frame.val) / item.value)
                        .min((max_items - frame.cnt) as i64)
                        .min(item.qty as i64) as u8
                };
                for take in (0..=max_take).rev() {
                    let new_val = frame.val + take as i64 * item.value;
                    let new_cnt = frame.cnt + take;
                    if new_val <= max_value && new_cnt <= max_items {
                        let mut new_counts = frame.counts;
                        new_counts[frame.idx] = take;
                        stack.push(Frame {
                            idx: frame.idx + 1,
                            val: new_val,
                            cnt: new_cnt,
                            counts: new_counts,
                        });
                    }
                }
            }
        }
        combos
    }

    let mid = top_n / 2;
    let mut combos_a = enumerate_combos(&top_items[..mid], q.max_value, q.max_items);
    let combos_b = enumerate_combos(&top_items[mid..], q.max_value, q.max_items);
    info!(combos_a = combos_a.len(), combos_b = combos_b.len(), "Enumerated combos for evaluation");
    combos_a.sort_unstable_by_key(|c| c.value);
    let values_a: Vec<i64> = combos_a.iter().map(|c| c.value).collect();
    let midpoint = (q.min_value + q.max_value) / 2;

    let (_best_dist, best_picks) = combos_b.par_iter().map(|b| {
        let mut local_best_dist = i64::MAX;
        let mut local_best_picks: HashMap<i64, u8> = HashMap::new();

        let min_needed = q.min_value - b.value;
        let max_allowed = q.max_value - b.value;
        let start_idx = values_a.partition_point(|&v| v < min_needed);

        for a in &combos_a[start_idx..] {
            if a.value > max_allowed { break; }
            let total_cnt = a.count + b.count;
            if total_cnt < q.min_items || total_cnt > q.max_items { continue; }
            let mut val = a.value + b.value;
            let mut cnt = total_cnt;
            let mut k_used: usize = 0;
            if val < q.min_value || cnt < q.min_items {
                let need_val = (q.min_value - val).max(0);
                let need_cnt = (q.min_items - cnt).max(0) as usize;
                let k_val = leftover_prefix.partition_point(|&v| v < need_val);
                let k = need_cnt.max(k_val);
                if k == 0 || cnt as usize + k > q.max_items as usize || k > total_leftover_copies {
                    continue;
                } else {
                    val += leftover_prefix[k];
                    cnt += k as u8;
                    k_used = k;
                    if val > q.max_value { continue; }
                }
            }

            if val >= q.min_value && val <= q.max_value && cnt >= q.min_items && cnt <= q.max_items {
                let dist = if val >= midpoint { val - midpoint } else { midpoint - val };

                if dist < local_best_dist {
                    let mut picks: HashMap<i64, u8> = HashMap::new();
                    for (i, &take) in a.counts.iter().enumerate().take(mid) {
                        if take > 0 {
                            *picks.entry(top_items[i].item_id).or_insert(0) += take;
                        }
                    }

                    for (i, &take) in b.counts.iter().enumerate().take(top_n - mid) {
                        if take > 0 {
                            *picks.entry(top_items[mid + i].item_id).or_insert(0) += take;
                        }
                    }

                    let mut needed = 0usize;
                    'outer: for item in leftover {
                        if needed == k_used { break; }
                        let take = item.qty.min((k_used - needed) as u8) as usize;
                        if take > 0 {
                            *picks.entry(item.item_id).or_insert(0) += take as u8;
                            needed += take;
                            if needed == k_used { break 'outer; }
                        }
                    }

                    local_best_dist = dist;
                    local_best_picks = picks;
                }
            }
        }

        (local_best_dist, local_best_picks)
    }).reduce(|| (i64::MAX, HashMap::new()), |a, b| if b.0 < a.0 { b } else { a });

    let result = best_picks;
    info!(elapsed_ms = start.elapsed().as_millis(), "process_request completed");
    Ok(result)
}

async fn handler(Query(q): Query<ItemRangeQuery>) -> impl IntoResponse {
    match process_request(q).await {
        Ok(picks) => {
            let picks_json: JsonMap<String, JsonValue> = picks.into_iter()
                .map(|(id, qty)| (id.to_string(), JsonValue::from(qty)))
                .collect();
            (StatusCode::OK, Json(serde_json::json!({"success": true, "picks": picks_json}))).into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let app = Router::new().route("/items/find_items_in_range", get(handler));
    let addr = SocketAddr::from(([0, 0, 0, 0], 4000));
    info!(%addr, "Listening on address");
    let listener = TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}