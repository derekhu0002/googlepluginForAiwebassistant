import { z } from "zod";

export const captureSchema = z.object({
  pageTitle: z.string().max(500).default(""),
  pageUrl: z.string().url().max(2048),
  metaDescription: z.string().max(2000).default(""),
  h1: z.string().max(500).default(""),
  selectedText: z.string().max(5000).default("")
}).catchall(z.string().max(5000));

export const analyzeRequestSchema = z.object({
  capture: captureSchema,
  context: z.object({
    source: z.string().max(100).optional(),
    capturedAt: z.string().max(100).optional()
  }).optional()
});

export const messageFeedbackRequestSchema = z.object({
  runId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(200),
  feedback: z.enum(["like", "dislike"])
});

export type AnalyzeRequestInput = z.infer<typeof analyzeRequestSchema>;
export type MessageFeedbackRequestInput = z.infer<typeof messageFeedbackRequestSchema>;
