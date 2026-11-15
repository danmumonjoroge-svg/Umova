// Test-only: lets Node resolve the POS's extensionless / directory imports exactly like Vite does. Not shipped to the app.
import { register } from 'node:module';
register('./resolve-hook.mjs', import.meta.url);
