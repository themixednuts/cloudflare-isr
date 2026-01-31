/// <reference path="./cloudflare.d.ts" />

declare global {
  namespace App {
    interface Platform {
      env: {
        ISR_CACHE: KVNamespace;
        TAG_INDEX: DurableObjectNamespace;
      };
      context: ExecutionContext;
    }
  }
}

export {};
