// Utility function to truncate messages based on character count to stay under token limits
// This prevents API errors when messages exceed the model's context window

export interface MessageForTruncation {
  role: string;
  content: string;
}

/**
 * Truncates messages to stay under the specified character limit
 * Always preserves the system message (first message)
 * Removes oldest user/assistant messages as needed
 * 
 * @param messages Array of messages to potentially truncate
 * @param maxCharacters Maximum total character count (default: 200,000)
 * @returns Object with truncated messages and truncation info
 */
export function truncateMessagesIfNeeded(
  messages: MessageForTruncation[], 
  maxCharacters = 150000
): { messages: MessageForTruncation[]; wasTruncated: boolean; removedCount: number } {
  // Calculate total character count
  const totalCharacters = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  
  if (totalCharacters <= maxCharacters) {
    return { 
      messages, 
      wasTruncated: false, 
      removedCount: 0 
    }; // No truncation needed
  }
  
  console.log(`[Truncation] Total characters (${totalCharacters}) exceeds limit (${maxCharacters}), truncating messages...`);
  
  // Always preserve the system message (first message)
  const systemMessage = messages[0];
  if (!systemMessage) {
    console.warn('No system message found, returning original messages');
    return { 
      messages, 
      wasTruncated: false, 
      removedCount: 0 
    }; // Safety check
  }
  
  const otherMessages = messages.slice(1);
  
  // Start with system message and calculate its character count
  let currentCharacters = systemMessage.content.length;
  const truncatedMessages: MessageForTruncation[] = [systemMessage];
  
  // Add messages from the end (most recent) working backwards
  // until we would exceed the character limit
  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const message = otherMessages[i];
    if (!message) continue;
    
    const messageCharacters = message.content.length;
    
    if (currentCharacters + messageCharacters <= maxCharacters) {
      truncatedMessages.splice(1, 0, message); // Insert after system message
      currentCharacters += messageCharacters;
    } else {
      // This message would put us over the limit, stop here
      break;
    }
  }
  
  const removedCount = messages.length - truncatedMessages.length;
  if (removedCount > 0) {
  console.log(`[Truncation] Removed ${removedCount} oldest messages to stay under character limit`);
  console.log(`[Truncation] Final character count: ${currentCharacters} (limit: ${maxCharacters})`);
  }
  
  return { 
    messages: truncatedMessages, 
    wasTruncated: removedCount > 0, 
    removedCount 
  };
}
