import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { Send, MessageCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  timestamp: string;
}

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserId: string;
  isMinimized: boolean;
  onToggleMinimize: () => void;
}

export const Chat = ({ 
  messages, 
  onSendMessage, 
  currentUserId,
  isMinimized,
  onToggleMinimize
}: ChatProps) => {
  const [inputText, setInputText] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSendMessage = () => {
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className={cn(
      "fixed bottom-4 right-4 w-80 bg-background border rounded-lg shadow-lg transition-all duration-300 z-50",
      isMinimized ? "h-12" : "h-96"
    )}>
      {/* Header */}
      <div 
        className="flex items-center justify-between p-3 border-b bg-muted/50 rounded-t-lg cursor-pointer"
        onClick={onToggleMinimize}
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          <span className="font-medium text-sm">Chat</span>
          {messages.length > 0 && (
            <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">
              {messages.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
        >
          {isMinimized ? <MessageCircle className="h-3 w-3" /> : <X className="h-3 w-3" />}
        </Button>
      </div>

      {/* Chat Content */}
      {!isMinimized && (
        <>
          {/* Messages */}
          <ScrollArea ref={scrollAreaRef} className="flex-1 h-72 p-3">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No messages yet. Start the conversation!
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={{
                    ...message,
                    isOwn: message.sender_id === currentUserId
                  }}
                />
              ))
            )}
          </ScrollArea>

          {/* Input */}
          <div className="p-3 border-t bg-muted/30 rounded-b-lg">
            <div className="flex gap-2">
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a message..."
                className="flex-1 h-8 text-sm"
                maxLength={500}
              />
              <Button
                onClick={handleSendMessage}
                size="sm"
                className="h-8 w-8 p-0"
                disabled={!inputText.trim()}
              >
                <Send className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};