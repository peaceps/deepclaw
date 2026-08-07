import {IMService} from '@/im/im-service';
import { LoopGateway } from '@deepclaw/loop-gateway';
import '@/i18n-server';

LoopGateway.initGateway();
IMService.init();
