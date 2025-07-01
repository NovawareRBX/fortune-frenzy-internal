# syntax=docker/dockerfile:1.4

FROM rust:slim AS rust-builder
WORKDIR /svc/item-range-svc
COPY item-range-svc/Cargo.toml item-range-svc/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo fetch --locked
COPY item-range-svc/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked
FROM node:22-slim AS node-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
FROM node:22-slim
WORKDIR /app
COPY --from=node-builder /app ./
COPY --from=rust-builder /svc/item-range-svc/target/release/item-range-svc /usr/local/bin/item-range-svc
EXPOSE 3000 4000
CMD ["npm", "start"]
