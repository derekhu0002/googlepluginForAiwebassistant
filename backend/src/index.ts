import { createApp } from "./app.js";
import { env } from "./config.js";
import { createAnalysisProvider } from "./providers/index.js";

const app = createApp(createAnalysisProvider());

app.listen(env.PORT, () => {
  console.log(`Mock analysis API listening on port ${env.PORT}`);
});
