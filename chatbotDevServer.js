import express from "express";
import chatbotRoutes from "./routes/chatbotRoutes.js";
import chatbotDevSessionMiddleware from "./middleware/chatbotDevSessionMiddleware.js";

const app = express();

// CORS: allow only the local Vite development frontend
app.use((req, res, next) => {
    const allowedOrigin = "http://localhost:5173";

    if (req.headers.origin === allowedOrigin) {
        res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS"
        );
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, x-session-id"
        );
    }

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

app.use(express.json());

// All chatbot endpoints require a valid local session
app.use(
    "/api/chatbot",
    chatbotDevSessionMiddleware,
    chatbotRoutes
);

const PORT = 4001;

app.listen(PORT, "127.0.0.1", () => {
    console.log(
        `Chatbot development server running on http://127.0.0.1:${PORT}`
    );
});