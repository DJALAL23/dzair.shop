import { appRequest } from "../api";
import type { ReviewRules } from "./types";

export const getReviewsApp = () => appRequest<ReviewRules>("reviews", "", "GET");

export const saveReviewsApp = (rules: Partial<ReviewRules>) => appRequest<ReviewRules>("reviews", "", "PUT", rules);
