import Fastify from "fastify";
import dotenv from "dotenv";
import cluster from "cluster";
import { cpus } from "os";

dotenv.config();

import indexRoute from "./routes/index";
import userRoutes from "./routes/users";
import marketplaceRoutes from "./routes/marketplace";

const numCPUs = cpus().length;
if (cluster.isPrimary) {
  console.log(`Primary process ${process.pid} is running`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Forking a new worker.`);
    cluster.fork();
  });
} else {
  const server = Fastify();

  const start = async () => {
    try {
      await server.register(indexRoute);
      await server.register(userRoutes);
      await server.register(marketplaceRoutes);

      await server.listen({ port: 3000, host: "0.0.0.0" });

      console.log(`Worker ${process.pid} is running on port 3001`);
    } catch (error) {
      console.log("Error starting server");
      console.log(error);
      server.log.error(error);
      process.exit(1);
    }
  };

  start();
}