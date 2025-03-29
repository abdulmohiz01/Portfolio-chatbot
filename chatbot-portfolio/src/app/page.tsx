"use client";

import dynamic from 'next/dynamic';

// Use dynamic import with no SSR for the ChatContainer
// This is needed because the ChatContainer uses browser APIs
const ChatContainer = dynamic(
  () => import('./components/ChatContainer'),
  { ssr: false }
);

export default function Home() {
  return (
    <div className="h-screen bg-gray-900 text-white">
      <ChatContainer />
    </div>
  );
}
