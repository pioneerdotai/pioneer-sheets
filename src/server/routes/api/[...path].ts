import { defineHandler } from "nitro";
import { handleApi } from "../../http/api";

export default defineHandler((event) => handleApi(event.req));
