import { generateAIEmailContent } from './ai';
import { ParsedMessage } from '@/types';

export async function generateInitialReply(emailData: ParsedMessage[]) {
  let prompt = 'Generate a complete email reply based on this thread:\n\n';

  if (emailData[0]?.subject) {
    prompt += `Subject: ${emailData[0].subject}\n\n`;
  }

  emailData
    .slice()
    .reverse()
    .forEach((email, index) => {
      prompt += `Email ${index + 1}:\n`;
      prompt += `From: ${email.sender.name} <${email.sender.email}>\n`;
      prompt += `Time: ${email.receivedOn}\n`;
      prompt += `Content:\n${email.body}\n\n`;
    });

  prompt += '\nPlease generate a natural and contextual reply that:';
  prompt += '\n1. Addresses key points from previous emails';
  prompt += '\n2. Maintains appropriate tone and formality';
  prompt += '\n3. Includes a suitable greeting and sign-off';

  const response = await generateAIEmailContent({
    prompt,
    currentContent: '',
  });

  if (!response.content) {
    throw new Error('Failed to generate reply content');
  }

  const paragraphs = response.content.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }));

  return {
    document: {
      type: 'doc',
      content: paragraphs,
    },
    plainText: response.content,
  };
}
