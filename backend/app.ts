import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./src/routes/auth";

dotenv.config({ quiet: true });

const app = express();

app.use(cors({ 
  origin: process.env.CLIENT_URL, 
  credentials: true 
}));
app.use(cookieParser());
app.use(express.json());

app.use("/auth", authRoutes);

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("❌ Error:", err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${process.env.BASE_URL}`);
});