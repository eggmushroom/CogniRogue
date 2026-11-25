import { startService } from './service.mjs';

const child = startService(process.env.PORT ?? '7777');
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
