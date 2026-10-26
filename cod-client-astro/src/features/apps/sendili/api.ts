import { appRequest } from "../api";
import type { SendiliKeyCheck, SendiliSetup, SendiliSetupInput } from "./types";

export const getSendiliApp = () => appRequest<SendiliSetup | null>("sendili", "", "GET");

export const saveSendiliApp = (input: SendiliSetupInput) => appRequest<SendiliSetup>("sendili", "", "PUT", input);

/** Check a key with Sendili and list the domains it may send from: the one typed, or the stored one. */
export const testSendiliKey = (apiKey?: string) => appRequest<SendiliKeyCheck>("sendili", "/test", "POST", apiKey ? { apiKey } : {});
