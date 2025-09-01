import { format } from 'date-fns';

interface ChatMessageProps {
  message: {
    id: string;
    sender_name: string;
    text: string;
    timestamp: string;
    isOwn: boolean;
  };
}

export const ChatMessage = ({ message }: ChatMessageProps) => {
  return (
    <div className={`flex ${message.isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[70%] rounded-lg px-3 py-2 ${
        message.isOwn 
          ? 'bg-primary text-primary-foreground' 
          : 'bg-muted text-muted-foreground'
      }`}>
        {!message.isOwn && (
          <p className="text-xs font-medium mb-1 opacity-70">
            {message.sender_name}
          </p>
        )}
        <p className="text-sm break-words">{message.text}</p>
        <p className="text-xs opacity-60 mt-1">
          {format(new Date(message.timestamp), 'HH:mm')}
        </p>
      </div>
    </div>
  );
};