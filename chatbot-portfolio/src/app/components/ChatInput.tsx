"use client";

import React, { useState, FormEvent, KeyboardEvent } from 'react';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, isLoading }) => {
  const [message, setMessage] = useState<string>('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      onSendMessage(message);
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-700 p-4 bg-gray-800 sticky bottom-0">
      <div className="relative rounded-lg overflow-hidden flex items-center">
        {isLoading && (
          <div className="absolute inset-0 bg-gray-800 bg-opacity-70 flex items-center justify-center z-10">
            <div className="flex items-center">
              <div className="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mr-2"></div>
              <span className="text-purple-400 font-medium">Thinking...</span>
            </div>
          </div>
        )}
        <textarea
          className="w-full border-0 bg-gray-700 text-white p-4 pr-12 rounded-lg resize-none placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:outline-none"
          placeholder="Add a message..."
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !message.trim()}
          className="absolute right-2 p-2 rounded-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white rotate-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </form>
  );
};

export default ChatInput; 