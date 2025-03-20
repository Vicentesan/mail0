// The brain.ts file in /actions should replace this file once ready.
'use server';

import { AIResponse, generateEmailContent, UserContext } from "@/lib/ai";
import { JSONContent } from "novel";

interface AIEmailResponse {
  content: string;
  jsonContent: JSONContent;
  type: 'email' | 'question' | 'system';
}

// Shared conversation history store
const conversationHistories: Record<string, {role: 'user' | 'assistant' | 'system', content: string}[]> = {};

export async function generateAIEmailContent({
  prompt,
  currentContent,
  to,
  isEdit = false,
  conversationId,
  userContext,
}: {
  prompt: string;
  currentContent?: string;
  to?: string[];
  isEdit?: boolean;
  conversationId?: string;
  userContext?: UserContext;
}): Promise<AIEmailResponse> {
  try {
    const responses = await generateEmailContent(prompt, currentContent, to, conversationId, userContext);
    
    const questionResponse = responses.find(r => r.type === 'question');
    if (questionResponse) {
      return {
        content: questionResponse.content,
        jsonContent: createJsonContent([questionResponse.content]),
        type: 'question'
      };
    }
    
    const emailResponses = responses.filter(r => r.type === 'email');
    let cleanedContent = emailResponses.map(r => r.content).join("\n\n").trim();
    
    const paragraphs = cleanedContent.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    
    const jsonContent = createJsonContent(paragraphs);
    
    return {
      content: cleanedContent,
      jsonContent,
      type: 'email'
    };
  } catch (error) {
    console.error("Error generating AI email content:", error);
    
    return {
      content: "Sorry, I encountered an error while generating content. Please try again with a different prompt.",
      jsonContent: createJsonContent(["Sorry, I encountered an error while generating content. Please try again with a different prompt."]),
      type: 'system'
    };
  }
}

export async function generateAIQuickReply(
  prompt: string,
  currentContent?: string,
  recipients?: string[],
  userContext?: UserContext
): Promise<AIEmailResponse[]> {
  try {
    const responseStyles = [
      { style: 'Professional', prompt: 'Generate a brief, professional reply: ' },
      { style: 'Friendly', prompt: 'Generate a brief, warm and friendly reply: ' },
      { style: 'Concise', prompt: 'Generate an extremely concise reply: ' }
    ] as const;

    // Generate responses for each style
    const allResponses = await Promise.all(
      responseStyles.map(async ({ style, prompt: stylePrompt }) => {
        const modifiedContext = userContext ? {
          ...userContext,
          name: userContext.name ? `${userContext.name} (Quick ${style} Reply)` : undefined
        } : undefined;

        return generateEmailContent(
          stylePrompt + prompt,
          currentContent,
          recipients,
          undefined,
          modifiedContext
        ).catch(() => null);
      })
    );

    // Check if any response is a question
    const questionResponse = allResponses
      .flatMap(r => (r || []) as AIResponse[])
      .find(r => r?.type === 'question');

    if (questionResponse) {
      return [{
        content: questionResponse.content,
        jsonContent: createJsonContent([questionResponse.content]),
        type: 'question'
      }];
    }

    // Process all email responses
    const responses = allResponses.flatMap(r => (r || []) as AIResponse[]);
    const emailResponses = responses.filter((r): r is AIResponse => r?.type === 'email');

    // Combine responses with style labels
    return emailResponses.map((response, index) => {
      const style = responseStyles[index]?.style || 'Unknown';
      const content = response?.content;
      const formattedContent = content 
        ? `[${style}]\n\n${content}`
        : `No ${style.toLowerCase()} response generated.`;

      return {
        content: formattedContent,
        jsonContent: createJsonContent([formattedContent]),
        type: 'email'
      };
    });
  } catch (error) {
    console.error("Error generating quick replies:", error);
 
    return [{
      content: "Sorry, I encountered an error while generating content. Please try again with a different prompt.",
      jsonContent: createJsonContent(["Sorry, I encountered an error while generating content. Please try again with a different prompt."]),
      type: 'system'
    }];
  }
}

function createJsonContent(paragraphs: string[]): JSONContent {
  if (paragraphs.length === 0) {
    paragraphs = ["Failed to generate content. Please try again with a different prompt."];
  }
  
  return {
    type: "doc",
    content: paragraphs.map(paragraph => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }]
    }))
  };
} 