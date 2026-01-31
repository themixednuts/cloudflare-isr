export { ISRTagIndexDO } from "cloudflare-isr";

export default {
  fetch() {
    return new Response("This worker only hosts the ISRTagIndexDO Durable Object.");
  },
};
