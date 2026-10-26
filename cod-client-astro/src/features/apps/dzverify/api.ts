import { appRequest } from "../api";
import type { DZVerifyKeyCheck, DZVerifySetup, DZVerifySetupInput } from "./types";

export const getDZVerifyApp = () => appRequest<DZVerifySetup | null>("dzverify", "", "GET");

export const saveDZVerifyApp = (input: DZVerifySetupInput) => appRequest<DZVerifySetup>("dzverify", "", "PUT", input);

/** Check a key with DZVerify: the one typed, or the stored one when none is given. */
export const testDZVerifyKey = (apiKey?: string) => appRequest<DZVerifyKeyCheck>("dzverify", "/test", "POST", apiKey ? { apiKey } : {});
