import type { EvpBridge, EvpLayoutBridge } from '../shared/evp-api';

declare global {
  interface Window {
    evp: EvpBridge;
    evpLayout?: EvpLayoutBridge;
  }
}

export {};
