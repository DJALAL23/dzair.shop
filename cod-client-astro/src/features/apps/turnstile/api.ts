import { appRequest } from "../api";
import type { TurnstileSetup, TurnstileSetupInput } from "./types";

export const getTurnstileApp = () => appRequest<TurnstileSetup | null>("turnstile", "", "GET");

export const saveTurnstileApp = (input: TurnstileSetupInput) => appRequest<TurnstileSetup>("turnstile", "", "PUT", input);
