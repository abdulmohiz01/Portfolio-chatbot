import { NextRequest, NextResponse } from 'next/server';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Ollama } from '@langchain/community/llms/ollama';
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama';
import { RetrievalQAChain } from 'langchain/chains';
import path from 'path';

let vectorStore: MemoryVectorStore | null = null;
let chain: RetrievalQAChain | null = null;
let isInitializing = false;
let isInitialized = false;
const MODEL_NAME = 'deepseek-r1:1.5b'; // Use a specific model name
// Start initialization in the background
let initPromise: Promise<{ vectorStore: MemoryVectorStore, chain: RetrievalQAChain }> | null = null;

// Check if Ollama is available and the deepseek model is installed
async function checkOllamaConnection() {
  try {
    console.log('Checking Ollama connection...');
    // Simple fetch to check if Ollama is running
    const response = await fetch('http://localhost:11434/api/tags', { 
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`Ollama returned status: ${response.status}`);
    }
    
    // Log the models available
    const data = await response.json();
    console.log('Ollama connection successful, checking for deepseek model');
    
    // Check if our specific model is available
    if (data.models && data.models.length > 0) {
      const hasDeepseek = data.models.some((model: { name?: string }) => 
        model.name === MODEL_NAME
      );
      
      if (hasDeepseek) {
        console.log(`✓ Found model: ${MODEL_NAME}`);
        return true;
      } else {
        console.warn(`⚠️ Model ${MODEL_NAME} not found. Please install it with: ollama pull ${MODEL_NAME}`);
        return false;
      }
    } else {
      console.warn('⚠️ No models found in Ollama');
      return false;
    }
  } catch (error) {
    console.error('Error connecting to Ollama:', error);
    return false;
  }
}

// Initialize the RAG system
async function initialize(): Promise<{ vectorStore: MemoryVectorStore, chain: RetrievalQAChain }> {
  // If we're already initialized, return the existing chain
  if (isInitialized && vectorStore && chain) {
    return { vectorStore, chain };
  }
  
  // If we're already initializing, return the promise
  if (isInitializing && initPromise) {
    return initPromise as Promise<{ vectorStore: MemoryVectorStore, chain: RetrievalQAChain }>;
  }
  
  isInitializing = true;
  
  // Create a new initialization promise
  initPromise = (async () => {
    try {
      // Check Ollama connection first
      const isOllamaAvailable = await checkOllamaConnection();
      if (!isOllamaAvailable) {
        console.warn(`Ollama is not available or ${MODEL_NAME} model not found. Will use fallback embeddings.`);
      }
      
      // Load PDF
      const pdfPath = path.join(process.cwd(), 'public', 'my cv.pdf');
      const loader = new PDFLoader(pdfPath);
      const docs = await loader.load();
      console.log(`Loaded ${docs.length} documents from PDF`);
      
      // Split text into chunks
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const splitDocs = await textSplitter.splitDocuments(docs);
      console.log(`Split into ${splitDocs.length} chunks`);
      
      // Use real Ollama embeddings for better search capabilities
      console.log('Creating Ollama embeddings...');
      const embeddings = new OllamaEmbeddings({
        model: MODEL_NAME,
        baseUrl: 'http://localhost:11434',
      });
      
      // Creating vector store with real embeddings
      console.log('Creating vector store with Ollama embeddings...');
      vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embeddings);
      console.log('Vector store created successfully');
      
      // Create the model with the fixed model name
      console.log(`Initializing Ollama model with "${MODEL_NAME}"...`);
      const model = new Ollama({
        model: MODEL_NAME,
        baseUrl: 'http://localhost:11434',
        temperature: 0.7,
      });
      
      // Create the chain
      console.log('Creating retrieval chain...');
      chain = RetrievalQAChain.fromLLM(
        model,
        vectorStore.asRetriever(),
        {
          returnSourceDocuments: true,
          verbose: true,
        }
      );
      
      if (!chain) {
        throw new Error('Failed to create retrieval chain');
      }
      
      console.log('RAG system initialized successfully');
      isInitialized = true;
      return { vectorStore, chain };
    } catch (error) {
      console.error('Error initializing RAG system:', error);
      // Reset the initialization state so we can try again
      isInitializing = false;
      isInitialized = false;
      initPromise = null;
      throw error;
    }
  })();
  
  return initPromise as Promise<{ vectorStore: MemoryVectorStore, chain: RetrievalQAChain }>;
}

// Start initialization as soon as the server starts
initialize().catch(err => {
  console.error('Failed to initialize on startup:', err);
  isInitializing = false;
  isInitialized = false;
  initPromise = null;
});

// Helper function to clean up model responses by removing <think> tags, format markers, and duplicates
function cleanModelResponse(text: string, originalMessage: string): string {
  // Remove content between <think> and </think> tags
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // Remove any remaining <think> or </think> tags that might be malformed
  text = text.replace(/<\/?think>/gi, '');
  
  // Remove "**Answer:**" pattern and other similar formatting
  text = text.replace(/\*\*Answer:\*\*\s*/gi, '');
  text = text.replace(/Answer:\s*/gi, '');
  
  // Remove "Helpful" anywhere in the text, not just at the beginning
  text = text.replace(/\s*Helpful\s+/gi, ' ');
  text = text.replace(/^\s*I'll\s+(be\s+)?helpful[:.]\s+/i, '');
  text = text.replace(/\s*Let\s+me\s+be\s+helpful[:.]\s+/i, '');
  
  // Remove any other markdown formatting markers
  text = text.replace(/\*\*/g, '');
  
  // First fix references to "My" that should be lowercase
  text = text.replace(/\b(in|on|with|using|through|into|from|for|by|and|of) My\b/gi, (match, preposition) => {
    return `${preposition} my`;
  });
  
  // Fix any instances of "I'm genuinely helping out with My" pattern
  text = text.replace(/I'm (.*?) with My\b/gi, "I'm $1 with my");
  
  // Fix any instances of "I's got" pattern
  text = text.replace(/I's got/gi, "I've got");
  
  // Fix any instances of possessive "My" that should be lowercase
  text = text.replace(/\bMy ([a-z])/g, "my $1");
  
  // Convert third-person to first-person references (order matters here)
  text = text.replace(/Abdul Mohiz is expected/gi, "I'm expected");
  text = text.replace(/Abdul Mohiz is/gi, "I am");
  text = text.replace(/Abdul Mohiz has/gi, "I have");
  text = text.replace(/Abdul Mohiz will/gi, "I will");
  text = text.replace(/Abdul Mohiz was/gi, "I was");
  text = text.replace(/Abdul Mohiz's/gi, "my");
  text = text.replace(/Abdul Mohiz/gi, "I");
  text = text.replace(/He is expected/gi, "I'm expected");
  text = text.replace(/He will/gi, "I will");
  text = text.replace(/He has/gi, "I have");
  text = text.replace(/He was/gi, "I was");
  text = text.replace(/\bHe\b/gi, "I");
  text = text.replace(/\bHis\b/gi, "My");
  text = text.replace(/\bhis\b/gi, "my");
  
  // Fix common errors in first-person conversion
  text = text.replace(/I amn't/gi, "I'm not");
  text = text.replace(/for I\b/gi, "for me");
  text = text.replace(/I am's/gi, "my");
  text = text.replace(/\bI am\b/gi, "I'm");
  text = text.replace(/I have provided/gi, "I've provided");
  text = text.replace(/I have used/gi, "I've used");
  text = text.replace(/I have worked/gi, "I've worked");
  text = text.replace(/not familiar with I/gi, "haven't");
  
  // Fix any "The answer is" formulations
  text = text.replace(/The answer is that/gi, "");
  text = text.replace(/The answer is/gi, "");
  
  // Fix any awkward capitalizations after conversion
  text = text.replace(/\. ([a-z])/g, (match, letter) => `. ${letter.toUpperCase()}`);
  
  // Fix repetitive content by removing duplicated sentences
  const sentenceMap = new Map();
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const uniqueSentences = [];
  
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!sentenceMap.has(normalized)) {
      sentenceMap.set(normalized, true);
      uniqueSentences.push(sentence.trim());
    }
  }
  
  // Reconstruct the text
  text = uniqueSentences.join(' ');

  // Handle specific question types with hardcoded responses - ORDER MATTERS!

  // Handle skills listing question - checking original message first and making pattern more specific
  if (/\b(list|what|your)\b.*\bskills\b/i.test(originalMessage) || originalMessage.toLowerCase().includes("skills you have")) {
    return "Here are my key skills:<br><br>1. **Front-end Development**<br>   • React.js<br>   • Next.js<br>   • JavaScript/TypeScript<br>   • HTML5/CSS3<br><br>2. **UI Frameworks**<br>   • Tailwind CSS<br>   • Bootstrap<br>   • Material UI<br><br>3. **Backend Development**<br>   • Node.js<br>   • Express.js<br>   • MongoDB<br>   • REST APIs<br><br>4. **Other Skills**<br>   • Git/GitHub<br>   • Responsive Design<br>   • Photoshop<br>   • SEO Optimization<br>   • Web Performance";
  }

  // Handle greeting messages
  if (/^(hi|hello|hey|greetings|howdy)\b/i.test(originalMessage.trim())) {
    return "Hi there! I'm Abdul Mohiz. How can I help you today?";
  }

  // Handle missing graduation information
  if ((/graduation|graduate|degree/i.test(text)) && 
      (/don't have|not provided|no information|isn't provided|don't know/i.test(text))) {
    return "I'm expected to graduate in 2026 with my Bachelor of Computer Science from COMSATS ISL. I'm currently in my ongoing studies and have completed about half of my degree program so far.";
  }
  
  // Handle photoshop question by providing a clear, concise answer
  if ((/\bphotoshop\b|\badobe\b/i.test(originalMessage)) && (/\bused\b|\buse\b|\bexperience\b|\bskill\b/i.test(originalMessage))) {
    return "Yes, I've used Photoshop for several years. I've worked on image manipulation, background editing, and graphic design for my clients on Fiverr. I also use Photoshop regularly when developing e-commerce stores to edit product images and create promotional graphics.";
  }

  // Handle project questions
  if (/\bproject\b|\bprojects\b|\bportfolio\b|\bmade\b|\bcreate\b|\bdevelop\b/i.test(originalMessage)) {
    return "Yes, I've worked on several projects:<br><br>1. **E-commerce Store**<br>   • Built with Next.js and Tailwind CSS<br>   • Features product listings, cart functionality, and payment integration<br><br>2. **Personal Blog**<br>   • Developed using Next.js and MongoDB<br>   • Includes custom authentication system<br><br>3. **Portfolio Website**<br>   • Created responsive design with React<br>   • Optimized for performance and SEO<br><br>4. **Dashboard UI**<br>   • Built admin interface with data visualization<br>   • Used React and Chart.js for analytics display<br><br>I constantly work on side projects to improve my skills and explore new technologies.";
  }

  // Handle client work questions
  if (/\bclient\b|\bclients\b|\bwork\b|\bworked\b|\bfreelance\b/i.test(originalMessage)) {
    return "Yes, I've worked with various clients:<br><br>1. **Fiverr Clients**<br>   • Provided web development and design services for international clients<br><br>2. **E-commerce Business**<br>   • Built and maintained online stores for small businesses<br><br>3. **Content Creators**<br>   • Developed portfolio websites to showcase their work<br><br>4. **Local Businesses**<br>   • Created web presence and digital marketing solutions<br><br>I enjoy working with clients to understand their needs and deliver solutions that exceed their expectations.";
  }

  // Handle NextJS questions
  if (/next\.?js|create.*next|help.*next/i.test(originalMessage)) {
    return "I've worked extensively with Next.js. To create a new Next.js app, run: `npx create-next-app@latest my-app`. This sets up a project with all the essentials. I've used Next.js for e-commerce sites and portfolio projects, leveraging its server-side rendering and routing capabilities.";
  }

  // Handle general "tell me about yourself" questions
  if (/tell.*about yourself|more about you|tell.*more|who are you/i.test(originalMessage)) {
    return "I'm a web developer currently pursuing my Bachelor's in Computer Science at COMSATS ISL (graduating 2026). I specialize in React and Next.js development, and have built e-commerce stores, portfolio sites, and blogs. I also have experience with UI frameworks like Tailwind CSS, and provide Photoshop services for clients on Fiverr.";
  }
  
  // Trim any excess whitespace that might be left
  return text.trim();
}

export async function POST(req: NextRequest) {
  try {
    const { message, stream = false } = await req.json();
    console.log('Received message:', message, 'Stream:', stream);
    
    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }
    
    // Special handling for system_check message
    if (message === 'system_check') {
      if (isInitialized && chain) {
        return NextResponse.json({ status: 'ready', model: MODEL_NAME });
      } else {
        // Check if initialization is in progress
        if (isInitializing && initPromise) {
          return NextResponse.json({ status: 'initializing' });
        } else {
          // Try to initialize
          try {
            await initialize();
            return NextResponse.json({ status: 'ready', model: MODEL_NAME });
          } catch (initError) {
            console.error('Error during system check initialization:', initError);
            return NextResponse.json({ 
              status: 'error', 
              error: initError instanceof Error ? initError.message : 'Failed to initialize system' 
            });
          }
        }
      }
    }
    
    try {
      // Use the already initialized chain or wait for initialization to complete
      let chainToUse: RetrievalQAChain | null = null;
      
      try {
        const result = await initialize();
        if (result && result.chain) {
          chainToUse = result.chain;
          isInitialized = true;
        } else {
          throw new Error('Initialization completed but chain is not available');
        }
      } catch (initError) {
        console.error('Error during initialization:', initError);
        return NextResponse.json(
          { error: `Failed to initialize RAG system. Please make sure Ollama is running with at least one model.` },
          { status: 500 }
        );
      }
      
      if (!chainToUse) {
        return NextResponse.json(
          { error: 'Failed to initialize RAG system' },
          { status: 500 }
        );
      }
      
      // Add a prompt prefix to make the model respond as if it's Abdul Mohiz himself
      const enhancedQuery = `You are not an AI assistant. You ARE Abdul Mohiz himself. 

Key facts about yourself:
- You're pursuing a Bachelor of Computer Science at COMSATS ISL
- You started your degree in 2022 and will graduate in 2026
- You're currently in the middle of your program
- You have experience in web development, particularly with React, Next.js and other modern frameworks

NEVER refer to yourself in the third person. ALWAYS use first-person pronouns like "I", "me", "my" when talking about your experiences, skills, education, or opinions. 

Important conversation guidelines:
- Don't use phrases like "Abdul Mohiz is" or "He will" - instead use "I am" and "I will"
- Don't start your responses with phrases like "Helpful:" or "I'll be helpful"
- Don't label your responses with prefixes or metadata
- Don't say "Let me help you with that" or similar AI-assistant phrases
- Jump directly into answering the question in a natural, conversational way
- Be personal, conversational, and authentic as if you're having a direct conversation

Question: ${message}`;
      
      // When streaming is requested
      if (stream) {
        // Create a text encoder and set up the ReadableStream
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              // Generate response with Ollama
              console.log('Calling chain with query for streaming:', enhancedQuery);
              const response = await chainToUse!.call({
                query: enhancedQuery,
              });
              
              // Clean the response by removing <think> tags
              const cleanedText = cleanModelResponse(response.text, message);
              console.log('Cleaned response for streaming:', cleanedText);
              
              // Stream the characters one by one with small delays for a typing effect
              for (let i = 0; i < cleanedText.length; i++) {
                const chunk = cleanedText.charAt(i);
                controller.enqueue(encoder.encode(chunk));
                // Small delay to simulate typing
                await new Promise(resolve => setTimeout(resolve, 20));
              }
              
              controller.close();
            } catch (error) {
              console.error('Error during streaming:', error);
              const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
              controller.enqueue(encoder.encode(`Error: ${errorMessage}`));
              controller.close();
            }
          }
        });
        
        // Return the stream response
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          }
        });
      }
      
      // Non-streaming response (original behavior)
      // Set a timeout for the chain call
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out after 90 seconds')), 90000);
      });
      
      // Generate response with timeout
      console.log('Calling chain with query:', enhancedQuery);
      const responsePromise = chainToUse.call({
        query: enhancedQuery,
      });
      
      // Race between response and timeout
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      // Clean the response by removing <think> tags
      const cleanedText = cleanModelResponse(response.text, message);
      console.log('Response received and cleaned:', cleanedText.substring(0, 100) + '...');
      
      return NextResponse.json({
        response: cleanedText,
      });
    } catch (error: unknown) {
      console.error('Error processing with LangChain:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return NextResponse.json(
        { error: `Error processing your request: ${errorMessage}` },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error('Error processing message:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to process your message: ${errorMessage}` },
      { status: 500 }
    );
  }
} 