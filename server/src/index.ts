import "dotenv/config";
import { app } from "./app.js";

const PORT = 4000;
app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
