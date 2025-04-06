'use server';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { generateCompletions, truncateThreadContent } from '@/lib/groq';
import { extractTextFromHTML } from './extractText';

// Extracts the most important parts of an email thread to fit within token limits
async function extractEmailSummary(threadContent: string, maxTokens: number = 4000): Promise<string> {
  // First, strip HTML from the thread content
  threadContent = await extractTextFromHTML(threadContent);
  
  // Split the thread into individual emails
  const emails = threadContent.split('\n---\n');
  
  // If there's only one email or it's already small enough, just truncate it
  if (emails.length <= 1 || threadContent.length / 4 <= maxTokens) {
    return truncateThreadContent(threadContent, maxTokens);
  }
  
  // Get the most recent email
  const latestEmail = emails[emails.length - 1] || '';
  
  // Extract subject lines and senders from all emails
  const emailMetadata = emails.map(email => {
    const subjectMatch = email.match(/Subject: (.*?)(\n|$)/i);
    const fromMatch = email.match(/From: (.*?)(\n|$)/i);
    return {
      subject: subjectMatch ? subjectMatch[1] : 'No subject',
      from: fromMatch ? fromMatch[1] : 'Unknown sender'
    };
  });
  
  // Create a summary of the thread
  let summary = "Email Thread Summary:\n\n";
  emailMetadata.forEach((meta, index) => {
    summary += `Email ${index + 1}: From ${meta.from}, Subject: ${meta.subject}\n`;
  });
  
  // Add the full content of the most recent email
  summary += "\n\nMost recent email (full content):\n\n";
  summary += latestEmail;
  
  // If we still have token budget, add parts of the previous email
  const estimatedSummaryTokens = summary.length / 4;
  
  if (estimatedSummaryTokens < maxTokens * 0.8 && emails.length > 1) {
    const previousEmail = emails[emails.length - 2] || '';
    const remainingTokens = maxTokens - estimatedSummaryTokens;
    const safeCharLimit = Math.floor(remainingTokens * 4 * 0.8);
    
    if (previousEmail.length <= safeCharLimit) {
      summary += "\n\nPrevious email:\n\n" + previousEmail;
    } else {
      summary += "\n\nPrevious email (truncated):\n\n" + previousEmail.substring(0, safeCharLimit) + "...";
    }
  }
  
  return summary;
}


// Generates an AI response for an email reply based on the thread content
export async function generateAIResponse(
  threadContent: string,
  originalSender: string,
): Promise<string> {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  if (!process.env.GROQ_API_KEY) {
    throw new Error('Groq API key is not configured');
  }

  // Use a more aggressive content reduction approach
  const processedContent = extractEmailSummary(threadContent, 3000); // Reduced to 3000 tokens max

  // Create the system message
  const systemPrompt = `You are an email assistant helping ${session.user.name} write professional and concise email replies.
  
  Important instructions:
  - Generate a real, ready-to-send email reply, not a template
  - Do not include placeholders like [Recipient], [discount percentage], etc.
  - Do not include formatting instructions or explanations
  - Do not include "Subject:" lines
  - Do not include "Here's a draft..." or similar meta-text
  - Write as if this email is ready to be sent immediately
  - Use real, specific content instead of placeholders
  - Address the recipient directly without using [brackets]
  - Be concise but thorough (2-3 paragraphs maximum)
  - Write in the first person as if you are ${session.user.name}
  - Double space paragraphs (2 newlines)
  - Add two spaces below the sign-off
  - End with the name: ${session.user.name}`;
  
  // Create the user message - keep it shorter
  const prompt = `
  Here's the context of the email thread (some parts may be summarized or truncated due to length):
  ${processedContent}

  Generate a professional, helpful, and concise email reply to ${originalSender}.
  Keep your response under 200 words.
  `;

  try {
    // Use direct fetch to the Groq API
    const { completion } = await generateCompletions({
      model: 'llama3-8b-8192',
      systemPrompt: process.env.SYSTEM_PROMPT || systemPrompt,
      prompt,
      temperature: 0.7,
      max_tokens: 500
    });

    return completion;
  } catch (error: any) {
    console.error('Error generating AI response:', error);
    throw error;
  }
}
