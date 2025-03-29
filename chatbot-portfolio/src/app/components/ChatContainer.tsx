"use client";

import React, { useState, useRef, useEffect } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';

// Function to generate a unique ID
const generateUniqueId = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Define message type
interface Message {
  id: string;
  text: string;
  sender: string;
  isUser: boolean;
  timestamp: Date;
  hidden?: boolean;
}

interface SystemStatus {
  status: string;
  model?: string;
  error?: string;
}

const ChatContainer: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '3',
      text: 'Initializing chat... This might take a moment to connect.',
      sender: 'System',
      isUser: false,
      timestamp: new Date(),
    }
  ]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSystemReady, setIsSystemReady] = useState<boolean>(false);
  const [modelName, setModelName] = useState<string>('');
  const [streamedContent, setStreamedContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [userHasScrolled, setUserHasScrolled] = useState<boolean>(false);
  const [hasInitialized, setHasInitialized] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const streamAbortController = useRef<AbortController | null>(null);
  const [systemMessage, setSystemMessage] = useState<string>('Checking system status...');
  const [isSystemError, setIsSystemError] = useState<boolean>(false);

  // Check if the system is initialized
  useEffect(() => {
    let isInitializing = false;

    const checkSystemStatus = async () => {
      // Skip if already initialized or currently initializing
      if (hasInitialized || isInitializing) return;
      
      // Set flag to prevent concurrent initialization
      isInitializing = true;
      
      try {
        setIsLoading(true);
        setSystemMessage('Checking system status...');
        
        // Special message to check system status
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: 'system_check' }),
        });
        
        const data = await response.json() as SystemStatus;
        
        if (data.status === 'ready') {
          setIsSystemReady(true);
          setModelName(data.model || 'unknown');
          setHasInitialized(true);
          
          // Remove system message
          setMessages([]);
          
          // Set a timeout to let the UI update first, then stream the welcome message
          setTimeout(() => {
            const welcomeMessage = "Hi there! I'm Abdul Mohiz. Thanks for visiting my portfolio! Feel free to ask me anything about my experience, skills, projects, or background.";
            handleStreamedResponse(welcomeMessage, true);
          }, 100);
        } else if (data.status === 'initializing') {
          setSystemMessage('System is initializing. Please wait...');
          // Poll again in a few seconds
          setTimeout(checkSystemStatus, 3000);
        } else if (data.status === 'error') {
          setSystemMessage(`Error: ${data.error || 'Unknown error'}`);
          setIsSystemError(true);
        }
      } catch (error) {
        console.error('Error checking system status:', error);
        setSystemMessage('Error connecting to the system. Please make sure the server is running.');
        setIsSystemError(true);
      } finally {
        setIsLoading(false);
      }
    };

    checkSystemStatus();
  }, []);

  // Clean up streaming on unmount
  useEffect(() => {
    return () => {
      if (streamAbortController.current) {
        streamAbortController.current.abort();
      }
    };
  }, []);

  // Handle scroll behavior
  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    
    if (!messagesContainer) return;

    // Function to check if user is near bottom
    const isNearBottom = () => {
      const container = messagesContainer;
      if (!container) return false;
      
      const threshold = 100; // pixels from bottom to be considered "at bottom"
      return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    };

    // Scroll handler to detect when user scrolls away from bottom
    const handleScroll = () => {
      setUserHasScrolled(!isNearBottom());
    };

    messagesContainer.addEventListener('scroll', handleScroll);
    
    return () => {
      messagesContainer.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Smart scroll function that only scrolls if user is at bottom or sending a message
  const scrollToBottom = (force = false) => {
    // Always scroll on force=true (like when user sends a message)
    if (force || !userHasScrolled) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Scroll to bottom when messages change, new content is streamed, 
  // or user sends a message (force scroll)
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].isUser) {
      // Force scroll when user sends a message
      scrollToBottom(true);
      // Reset user scrolled state when user sends a message
      setUserHasScrolled(false);
    } else {
      // Normal scroll behavior for other updates
      scrollToBottom();
    }
  }, [messages, streamedContent]);

  // Add a placeholder message for streaming - but mark it as hidden until it has content
  const addStreamingPlaceholder = () => {
    const newId = generateUniqueId();
    setMessages((prev) => [...prev, {
      id: newId,
      text: '',
      sender: 'Abdul Mohiz',
      isUser: false,
      timestamp: new Date(),
      hidden: true
    }]);
    return newId;
  };

  // Update the streamed message
  const updateStreamedMessage = (id: string, content: string) => {
    setMessages((prev) => 
      prev.map((msg) => 
        msg.id === id 
          ? { 
              ...msg, 
              text: content,
              hidden: content.trim().length === 0
            } 
          : msg
      )
    );
  };

  // Process streamed responses
  const handleStreamedResponse = async (text: string, isWelcome: boolean = false) => {
    setIsStreaming(true);
    const messageId = addStreamingPlaceholder();
    let content = '';
    
    try {
      // If this is the welcome message, simulate streaming rather than calling API
      if (isWelcome) {
        // Simulate typing the welcome message
        for (let i = 0; i < text.length; i++) {
          // Add each character with a delay
          content += text[i];
          updateStreamedMessage(messageId, content);
          setStreamedContent(content);
          // Small delay to simulate typing
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      } else {
        // Create abort controller for cancelling stream
        streamAbortController.current = new AbortController();
        const signal = streamAbortController.current.signal;
        
        // Call API for streamed response
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: text, stream: true }),
          signal,
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }
        
        const decoder = new TextDecoder();
        
        // Read the stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          // Decode the chunk and add to content
          const chunk = decoder.decode(value, { stream: true });
          content += chunk;
          updateStreamedMessage(messageId, content);
          setStreamedContent(content);
        }
      }
      
      setIsSystemReady(true); // If we got a response, the system is ready
    } catch (error) {
      console.error('Error with streaming:', error);
      updateStreamedMessage(
        messageId, 
        error instanceof Error 
          ? `Sorry, I couldn't process your message due to a technical issue. Could you try asking in a different way?` 
          : 'Sorry, I encountered a connection issue. Could we try again in a moment?'
      );
    } finally {
      setIsStreaming(false);
      setIsLoading(false);
      streamAbortController.current = null;
    }
  };

  // Handle standard (non-streamed) responses
  const handleStandardResponse = async (text: string) => {
    // Add a hidden placeholder first
    const messageId = generateUniqueId();
    setMessages((prev) => [...prev, {
      id: messageId,
      text: '',
      sender: 'Abdul Mohiz',
      isUser: false,
      timestamp: new Date(),
      hidden: true
    }]);
    
    try {
      // Call API to get response
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Update the placeholder message with actual content
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === messageId
            ? { 
                ...msg, 
                text: data.response || 'Sorry, I couldn\'t process that request.',
                hidden: false // Make visible now
              }
            : msg
        )
      );
      
      setIsSystemReady(true); // If we got a response, the system is ready
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Update with error message
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === messageId
            ? { 
                ...msg, 
                text: error instanceof Error 
                  ? `Sorry, I couldn't respond to that. Could you please try asking in a different way?` 
                  : 'Sorry, I\'m having trouble responding right now. Let\'s try again in a moment.',
                hidden: false // Make visible now
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (text: string, isStreamed: boolean = true) => {
    if (!text.trim() || isLoading) return;

    // Add user message
    const userMessage: Message = {
      id: generateUniqueId(),
      text,
      sender: 'You',
      isUser: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    
    // Reset the userHasScrolled flag when sending a new message
    setUserHasScrolled(false);
    
    if (isStreamed) {
      await handleStreamedResponse(text);
    } else {
      await handleStandardResponse(text);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="bg-gray-800 text-white p-4 shadow-md text-center">
        <h1 className="text-xl font-bold flex items-center justify-center">
          Chat with Abdul Mohiz 
          {isSystemReady && (
            <span className="ml-2 w-3 h-3 rounded-full bg-green-500 inline-block"></span>
          )}
        </h1>
      </div>
      
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-900"
      >
        {messages.map((msg) => (
          !msg.hidden && (
            <ChatMessage
              key={msg.id}
              message={msg.text}
              isUser={msg.isUser}
              timestamp={msg.timestamp}
              senderName={msg.sender}
              isStreaming={isStreaming && msg.text !== '' && msg.id === messages[messages.length - 1]?.id && !msg.isUser}
            />
          )
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      {/* "New messages" indicator that appears when streaming and user has scrolled up */}
      {isStreaming && userHasScrolled && (
        <div 
          className="sticky bottom-16 w-full flex justify-center"
          style={{ pointerEvents: 'none' }}
        >
          <button 
            className="bg-purple-600 text-white px-4 py-2 rounded-full shadow-lg animate-pulse flex items-center"
            style={{ pointerEvents: 'auto' }}
            onClick={() => {
              scrollToBottom(true);
              setUserHasScrolled(false);
            }}
          >
            <span className="mr-2">⬇</span> New message
          </button>
        </div>
      )}
      
      <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading || isStreaming} />
    </div>
  );
};

export default ChatContainer; 