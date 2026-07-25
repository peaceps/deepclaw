import { IMService } from "./im/im-service";

export async function register() {
    if (process?.env.NEXT_RUNTIME === 'nodejs') {
        IMService.reset();
    }
}
