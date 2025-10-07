import express, { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const router = express.Router();
const prisma = new PrismaClient();

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  JWT_SECRET,
  BASE_URL,
  CLIENT_URL,
  NODE_ENV,
} = process.env;

// Initialize Google OAuth2 Client
const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/auth/google/callback`
);

interface JwtPayload {
  id: string;
  email: string;
}

// Step 1: Redirect user to Google consent screen
router.get("/google", (req: Request, res: Response) => {
  console.log("🔄 Redirecting to Google OAuth...");
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
  });

  console.log("📍 Auth URL:", authUrl);
  res.redirect(authUrl);
});

// Step 2: Handle the callback from Google
router.get("/google/callback", async (req: Request, res: Response) => {
  const { code, error } = req.query;

  console.log("🔄 Google callback received");
  console.log("📦 Query params:", { code: code ? "✓" : "✗", error });

  // Handle error from Google
  if (error) {
    console.error("❌ Google OAuth error:", error);
    return res.redirect(`${CLIENT_URL}/login?error=${error}`);
  }

  // No code means something went wrong
  if (!code || typeof code !== "string") {
    console.error("❌ No authorization code received");
    return res.redirect(`${CLIENT_URL}/login?error=no_code`);
  }

  try {
    // Exchange authorization code for tokens
    console.log("🔄 Exchanging code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    console.log("🔄 Fetching user info...");
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error("No payload in ID token");
    }

    console.log("✅ Google user info:", {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    });

    // Upsert user in database
    const user = await prisma.user.upsert({
      where: { googleId: payload.sub },
      update: {
        email: payload.email!,
        name: payload.name,
        picture: payload.picture,
      },
      create: {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name,
        picture: payload.picture,
      },
    });

    console.log("✅ User upserted:", user.id);

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET!,
      { expiresIn: "30d" }
    );

    console.log("✅ JWT generated");

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    console.log("✅ Cookie set, redirecting to dashboard");
    res.redirect(`${CLIENT_URL}/dashboard`);
  } catch (error) {
    console.error("❌ Error in Google callback:", error);
    res.redirect(`${CLIENT_URL}/login?error=authentication_failed`);
  }
});

// Get current user
router.get("/me", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, JWT_SECRET!) as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    res.json({ ok: true, user });
  } catch (error) {
    res.status(401).json({ ok: false, message: "Invalid or expired token" });
  }
});

// Logout
router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

export default router;