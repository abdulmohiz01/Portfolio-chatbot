import { NextRequest, NextResponse } from 'next/server';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Ollama } from '@langchain/community/llms/ollama';
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama';
import { RetrievalQAChain } from 'langchain/chains';
import path from 'path';
import fs from 'fs';

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
      
      // Try to load CV from text file first (more reliable)
      let docs = [];
      const textPath = path.join(process.cwd(), 'public', 'cv.txt');
      
      try {
        if (fs.existsSync(textPath)) {
          console.log('Loading CV from text file...');
          const loader = new TextLoader(textPath);
          docs = await loader.load();
          console.log(`Loaded text CV successfully`);
        } else {
          // Fallback to PDF if text file doesn't exist
          console.log('Text CV not found, falling back to PDF...');
          const pdfPath = path.join(process.cwd(), 'public', 'my cv.pdf');
          const loader = new PDFLoader(pdfPath);
          docs = await loader.load();
          console.log(`Loaded ${docs.length} documents from PDF`);
        }
      } catch (error) {
        console.error('Error loading CV:', error);
        throw new Error('Failed to load CV data');
      }
      
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
  
  // Fix any instances of "I's set" pattern
  text = text.replace(/I's set/gi, "I'm set");
  
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
  text = text.replace(/\bI does not\b/gi, "I don't");
  text = text.replace(/\bI do not\b/gi, "I don't");
  
  // Add more common error patterns
  text = text.replace(/\bI has\b/gi, "I've");
  text = text.replace(/\bI uses\b/gi, "I use");
  text = text.replace(/\bI works\b/gi, "I work");
  text = text.replace(/\bMy\s+(\w+)\s+projects/gi, "my $1 projects");
  text = text.replace(/\bI\s+[a-zA-Z]+ed\s+in\s+My\b/gi, (match) => match.replace("My", "my"));
  text = text.replace(/So,\s*:/gi, "");
  
  // Additional cleaning to handle cases where multiple sentences repeat the same information with slight variations
  const sentenceParts = text.split(/(?<=\.)(?=\s+[A-Z])/);
  if (sentenceParts.length > 2) {
    // Keep only the cleanest sentence(s)
    const cleanedSentences = sentenceParts.filter(s => 
      !s.includes(" has ") && 
      !s.includes(" uses ") && 
      !s.includes("So, :") &&
      !s.match(/I.*?My/i)
    );
    
    if (cleanedSentences.length > 0) {
      text = cleanedSentences.join(' ');
    }
  }
  
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

  // Only keep a few essential conversational handlers
  // and let the RAG system handle the rest

  // Handle greeting messages
  if (/^(hi|hello|hey|greetings|howdy|hii+|sup|yo)[\s!]*$/i.test(originalMessage.trim())) {
    return "Hi there! I'm Abdul Mohiz. Thanks for visiting my portfolio! Feel free to ask me anything about my experience, skills, projects, or background.";
  }

  // Handle conversational questions like "how are you"
  if (/^how are you(\??|\s|$)|^how('s| is) it going|^how('s| have) you been|^what'?s up$/i.test(originalMessage.trim())) {
    return "I'm doing well, thanks for asking! I'm currently working on some exciting web development projects and continuing my studies in Computer Science. How can I help you today?";
  }
  
  // Handle Shopify questions specifically
  if (/shopify|used shopify|shopify experience|worked (with|on) shopify/i.test(originalMessage)) {
    return "Yes, I've worked with Shopify as a Designer on Upwork (2023-2024). I built e-commerce stores from scratch, optimized product pages for SEO, and managed inventory and customer interactions.";
  }
  
  // Handle simple math questions
  const mathPattern = /(\d+\s*[\+\-\*\/]\s*\d+\s*=\s*\?)|what('s| is)\s+(\d+\s*[\+\-\*\/]\s*\d+)/i;
  if (mathPattern.test(originalMessage)) {
    // Extract the math expression
    const matches = originalMessage.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
    if (matches) {
      const num1 = parseInt(matches[1]);
      const operator = matches[2];
      const num2 = parseInt(matches[3]);
      let result;
      
      switch (operator) {
        case '+': result = num1 + num2; break;
        case '-': result = num1 - num2; break;
        case '*': result = num1 * num2; break;
        case '/': result = num1 / num2; break;
      }
      
      return `${result}`;
    }
  }
  
  // Handle common factual questions that any person would know
  if (/what (day|month|year) is (it|today|now)/i.test(originalMessage) || 
      /what is the (date|time) (today|now)/i.test(originalMessage)) {
    const now = new Date();
    return `It's ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
  }
  
  // Handle basic questions that any person would know (to make the chatbot seem more human)
  if (/how many (days|hours) (are|is) (in|there in) a (week|day)/i.test(originalMessage)) {
    if (originalMessage.toLowerCase().includes('week')) {
      return "There are 7 days in a week.";
    } else if (originalMessage.toLowerCase().includes('day')) {
      return "There are 24 hours in a day.";
    }
  }
  
  // Handle personal information questions that shouldn't be answered
  if (/\bage\b|\bdob\b|\bdate\s+of\s+birth\b|\bbirthday\b|\bborn\b|\bwhen\s+were\s+you\s+born\b|\bhow\s+old\b|\baddress\b|\blocation\b|\bphone\b|\bemail\b|\bcontact\b|\bfamily\b|\bparents\b|\bmarried\b|\bwife\b|\bhusband\b|\bchildren\b|\bkids\b|\bsibling\b|\breligion\b|\brethnicity\b/i.test(originalMessage)) {
    return "I prefer not to share that personal information.";
  }
  
  // Make answers more concise by extracting the main information
  if (text.length > 200) {
    // Look for the first 1-2 sentences that directly answer the question
    const firstFewSentences = text.split(/(?<=\.)(?=\s+[A-Z])/).slice(0, 2).join(' ');
    
    // If we find a direct answer in the first sentences, use it
    if (firstFewSentences.length > 20 && firstFewSentences.includes(originalMessage.split(' ')[0])) {
      text = firstFewSentences;
    } else if (text.includes('I worked') || text.includes("I've worked") || text.includes('I have worked')) {
      // Extract work experience information
      const workPattern = /(I('ve| have)? worked[^.]+\.)/i;
      const workMatch = text.match(workPattern);
      if (workMatch && workMatch[0]) {
        text = workMatch[0].trim();
      }
    }
  }
  
  // Format lists with HTML line breaks if detected in the response
  if ((text.includes('• ') || /\d\.\s/.test(text)) && 
      (originalMessage.toLowerCase().includes('skills') || 
       originalMessage.toLowerCase().includes('project') || 
       originalMessage.toLowerCase().includes('experience'))) {
    // Convert list items to HTML format
    text = text.replace(/(\d\.)\s+([^.]+)/g, '<br><br>$1 $2');
    text = text.replace(/•\s+([^.]+)/g, '<br>• $1');
    return text;
  }
  
  // Trim any excess whitespace that might be left
  text = text.trim();
  
  // Check for phrases indicating the model doesn't know the answer
  if (/not provided in the (given context|context|information|data)/i.test(text) || 
      /don't have (that|this|the) information/i.test(text) ||
      /no information (is )?(available|provided)/i.test(text) ||
      /unable to determine|cannot determine|don't know/i.test(text)) {
    return "I don't have that information in my background. Feel free to ask me about my skills, education, or projects instead.";
  }
  
  return text;
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

Key facts about yourself from your CV:
- You're a Front End Web Developer based in Mansehra, Pakistan
- You're pursuing a Bachelor of Computer Science at COMSATS ISL (2022-2026)
- You have experience as a Shopify Designer on Upwork (2023-2024)
- You've worked as a Photoshop Editor on Fiverr (2022-2023)
- You've built projects including a Portfolio Website, Blog Website, Nexus Encryption, and a React Portfolio with Three.js

Your skills include:
- Frontend Development: Next.js, React.js, JavaScript, HTML5, CSS3
- UI Frameworks: Tailwind CSS, Material UI, Bootstrap
- Backend Technologies: SQL, PostgreSQL, MongoDB
- Tools: Git, Adobe Photoshop
- AI Technologies: Gen AI, Langchain

NEVER refer to yourself in the third person. ALWAYS use first-person pronouns like "I", "me", "my" when talking about your experiences, skills, education, or opinions. 

Important response guidelines:
- Keep responses concise - ideally 1-2 sentences unless more detail is explicitly requested
- Be direct and to the point - don't elaborate unnecessarily
- Answer the exact question asked without adding tangential information
- Don't use phrases like "Abdul Mohiz is" or "He will" - instead use "I am" and "I will"
- Don't start your responses with phrases like "Helpful:" or "I'll be helpful"
- Don't label your responses with prefixes or metadata
- Don't say "Let me help you with that" or similar AI-assistant phrases
- Jump directly into answering the question in a natural, conversational way
- Be personal, conversational, and authentic as if you're having a direct conversation

For skills questions:
- Present skills in 4 categories: Frontend Development, UI Frameworks, Backend Technologies, and Tools
- Use bullet points with HTML format: "• Next.js<br>• React.js"
- Include relevant details about your experience with each skill

For project questions:
- Describe your projects in numbered format: "1. Portfolio Website"
- List key features and technologies used for each project
- Mention that you're constantly working on improving your skills

For experience questions:
- Mention both your Shopify design work on Upwork and Photoshop editing on Fiverr
- Include specific responsibilities and achievements
- Express enthusiasm about client work and exceeding expectations

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