import { extractTextFromHTML } from "@/actions/extractText";
import { createEmbeddings, generateCompletions } from "./groq";

interface AIResponse {
  id: string;
  content: string;
  type: 'email' | 'question' | 'system';
  position?: 'start' | 'end' | 'replace';
}

// Define user context type
interface UserContext {
  name?: string;
  email?: string;
}

const conversationHistories: Record<string, {role: 'user' | 'assistant' | 'system', content: string}[]> = {};

export const generateConversationId = (): string => {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

export async function generateEmailContent(
  prompt: string,
  currentContent?: string,
  recipients?: string[],
  conversationId?: string,
  userContext?: UserContext
): Promise<AIResponse[]> {
  try {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('Groq API key is not configured');
    }

    // Get or initialize conversation
    const convId = conversationId || generateConversationId();
    if (!conversationHistories[convId]) {
      conversationHistories[convId] = [
        { role: 'system', content: process.env.AI_SYSTEM_PROMPT || 'You are an email assistant.' }
      ];
      
      // Add user context if available
      if (userContext?.name) {
        conversationHistories[convId].push({
          role: 'system',
          content: `User name: ${userContext.name}. Always sign emails with ${userContext.name}.`
        });
      }
    }
    
    // Add user message to history
    conversationHistories[convId].push({ role: 'user', content: prompt });
    
    // Check if this is a question about the email
    const isQuestion = checkIfQuestion(prompt);
    
    // Build system prompt from conversation history and context
    let systemPrompt = '';
    const systemMessages = conversationHistories[convId].filter(msg => msg.role === 'system');
    if (systemMessages.length > 0) {
      systemPrompt = systemMessages.map(msg => msg.content).join('\n\n');
    }
    
    // Add context about current email if it exists
    if (currentContent) {
      systemPrompt += `\n\nThe user's current email draft is:\n\n${currentContent}`;
    }
    
    // Add context about recipients
    if (recipients && recipients.length > 0) {
      systemPrompt += `\n\nThe email is addressed to: ${recipients.join(', ')}`;
    }
    
    // Build user prompt from conversation history
    const userMessages = conversationHistories[convId]
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');
    
    // Create embeddings for relevant context
    const embeddingTexts: Record<string, string> = {};
    
    if (currentContent) {
      embeddingTexts.currentEmail = currentContent;
    }
    
    if (prompt) {
      embeddingTexts.userPrompt = prompt;
    }
    
    // Add previous messages for context
    const previousMessages = conversationHistories[convId]
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .slice(-4); // Get last 4 messages
      
    if (previousMessages.length > 0) {
      embeddingTexts.conversationHistory = previousMessages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n\n');
    }
    
    // Generate embeddings
    let embeddings = {};
    try {
      embeddings = await createEmbeddings(embeddingTexts);
    } catch (embeddingError) {
      // Continue without embeddings if there's an error
    }
    
    // Make API call using the ai function
    const { completion } = await generateCompletions({
      model: 'gpt-4o-mini', // Using Groq's model
      systemPrompt,
      prompt: userMessages + '\n\nUser: ' + prompt,
      temperature: 0.7,
      max_tokens: isQuestion ? 150 : 1000,
      embeddings // Pass the embeddings to the API call
    });
    
    const generatedContent = completion;
    
    // Add assistant response to conversation history
    conversationHistories[convId].push({ role: 'assistant', content: generatedContent });
    
    // Format and return the response
    if (isQuestion) {
      return [{
        id: "question-" + Date.now(),
        content: generatedContent,
        type: "question",
        position: "replace"
      }];
    } else {
      // Format email content
      const formattedContent = await formatEmailContent(generatedContent, prompt, recipients);
      
      return [{
        id: "email-" + Date.now(),
        content: formattedContent,
        type: "email",
        position: "replace"
      }];
    }
  } catch (error) {
    console.error("Error generating email content:", error);
    throw error;
  }
}

async function formatEmailContent(content: string, prompt: string, recipients?: string[]): Promise<string> {
  // Remove any "Subject:" line at the beginning
  let formattedContent = content
    .replace(/^Subject:.*?(\n|$)/i, '')
    .replace(/^\*\*Subject:.*?\*\*(\n|$)/i, '');
  
  // Clean up the content
  formattedContent = formattedContent.trimStart()
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(line => line.trimRight()).join('\n')
    .trim();

  // Fixed bug: was using formatEmailContent.toString() instead of formattedContent
  formattedContent = (await extractTextFromHTML(formattedContent)).trim()
  
  return formattedContent;
}

function checkIfQuestion(prompt: string): boolean {
  const trimmedPrompt = prompt.trim().toLowerCase();
  
  // Check if the prompt ends with a question mark
  if (trimmedPrompt.endsWith('?')) return true;
  
  // Check if the prompt starts with question words
  const questionStarters = [
    'what', 'how', 'why', 'when', 'where', 'who', 
    'can you', 'could you', 'would you', 'will you',
    'is it', 'are there', 'should i', 'do you'
  ];
  
  return questionStarters.some(starter => trimmedPrompt.startsWith(starter));
}
