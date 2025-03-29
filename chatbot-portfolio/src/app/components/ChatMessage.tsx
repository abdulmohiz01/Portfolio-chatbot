"use client";

import React from 'react';
import Image from 'next/image';

interface ChatMessageProps {
  message: string;
  isUser: boolean;
  timestamp: Date;
  senderName: string;
  isStreaming?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ 
  message, 
  isUser, 
  timestamp, 
  senderName,
  isStreaming = false
}) => {
  // Check if it's a system message
  const isSystem = senderName === 'System';
  
  // Format timestamp relative to current time
  const formatTime = (date: Date) => {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays <= 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  // Special styling for system messages
  if (isSystem) {
    return (
      <div className="flex justify-center mb-4">
        <div className="max-w-[90%] bg-blue-900 text-white px-4 py-2 rounded-lg text-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium">{senderName}</span>
            <span className="text-xs text-gray-300">{formatTime(timestamp)}</span>
          </div>
          <p>{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[80%] ${isUser ? 'order-1' : 'order-2'}`}>
        <div className={`
          flex items-start gap-2 
          ${isUser ? 'flex-row-reverse' : 'flex-row'}
        `}>
          <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden bg-gray-300 flex items-center justify-center">
            {/* Avatar placeholder */}
            <div className="text-gray-600 font-bold text-lg">
              {senderName.charAt(0).toUpperCase()}
            </div>
          </div>
          <div>
            <div className={`flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'} mb-1`}>
              <span className="font-medium">{senderName}</span>
              <span className="text-xs text-gray-500">{formatTime(timestamp)}</span>
            </div>
            <div className={`
              rounded-lg px-4 py-2 
              ${isUser 
                ? 'bg-purple-500 text-white rounded-tr-none' 
                : 'bg-gray-200 text-gray-800 rounded-tl-none'}
            `}>
              <div 
                dangerouslySetInnerHTML={{ __html: message }}
                className="inline"
              >
              </div>
              {/* Show a blinking cursor at the end when streaming */}
              {isStreaming && (
                <span className="inline-block w-2 h-4 bg-current ml-1 align-middle animate-pulse"></span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage; 