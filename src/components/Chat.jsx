import React, { useState, useEffect, useRef } from "react";
import { Send, Loader2 } from 'lucide-react';
// Išimtas generateGeminiContent importas, nes funkcija perkelta tiesiogiai į šį failą

// --- Gemini API Konfiguracija (Perkelta tiesiogiai) ---
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
const API_KEY = ""; // Naudosime automatizuotą Canvas raktą

// Funkcija, kuri siunčia užklausą į Gemini API su backoff mechanizmu
const generateGeminiContent = async (prompt, chatHistory) => {
    const historyForAPI = chatHistory.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user', // Gemini API naudoja 'user' ir 'model'
        parts: [{ text: msg.text }]
    }));

    // Sukuriamas pilnas pokalbio kontekstas su nauja vartotojo žinute
    const contents = [...historyForAPI.slice(0, -1).filter(msg => msg.parts[0].text.trim() !== 'Jūsų nemokamų žinučių kvota baigėsi. Prisijunkite prie Premium plano!'), {
        role: 'user',
        parts: [{ text: prompt }]
    }];

    const payload = {
        contents: contents,
        systemInstruction: {
            parts: [{ text: "Jūs esate draugiškas, profesionalus DI Namams asistentas. Atsakinėkite trumpai ir aiškiai apie buitį, pirkinius, maisto gaminimą ir namų priežiūrą. Atsakykite tik lietuviškai." }]
        },
    };

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        try {
            const response = await fetch(`${GEMINI_API_URL}${API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) { // Too Many Requests
                attempts++;
                const delay = Math.pow(2, attempts) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Bandome dar kartą
            }
            
            if (!response.ok) {
                 throw new Error(`API klaida: ${response.statusText}`);
            }

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!text) {
                // Jei API negrąžino teksto, grąžiname klaidos pranešimą, bet neleidžiame įvykti kvotos sumažinimui
                throw new Error("Negauta jokio teksto atsakymo iš AI.");
            }

            return { text };

        } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) {
                console.error("Gemini API visi bandymai nepavyko:", error);
                throw new Error("Nepavyko pasiekti DI asistento.");
            }
             // Laukiamas backoff prieš kitą bandymą
            const delay = Math.pow(2, attempts) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error("Nepavyko pasiekti DI asistento po kelių bandymų.");
};

// --- POKALBIO KOMPONENTAS ---
const Chat = ({ supabase, user }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState(null); // Kvotos būsena
  const messagesEndRef = useRef(null);

  // Vartotojo ID
  const userId = user?.id;
  const INITIAL_QUOTA = 20;
  
  // --- 1. Kvotos Įkėlimas ir Profilio Sukūrimas ---
  useEffect(() => {
    if (!userId) return;

    // Supabase realaus laiko prenumerata kvotos atnaujinimui
    const quotaSubscription = supabase
      .channel('public:profiles')
      .on('postgres_changes', 
          { 
              event: 'UPDATE', // Domina tik atnaujinimai
              schema: 'public', 
              table: 'profiles', 
              filter: `id=eq.${userId}` 
          }, 
          payload => {
              // Atnaujiname kvotos būseną realiu laiku
              if (payload.new.id === userId) {
                  setQuota(payload.new.quota);
              }
          })
      .subscribe();

    const loadQuota = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('quota')
        .eq('id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.error("Klaida įkeliant kvotą:", error);
        return;
      }

      if (data) {
        setQuota(data.quota);
      } else {
        // Vartotojas naujas, sukurti profilį su pradine kvota
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({ id: userId, quota: INITIAL_QUOTA });

        if (insertError) {
          console.error("Klaida kuriant profilį:", insertError);
        } else {
          setQuota(INITIAL_QUOTA);
        }
      }
    };

    loadQuota();

    // Išvalome prenumeratą
    return () => {
        supabase.removeChannel(quotaSubscription);
    };

  }, [userId, supabase]);


  // Scroll to bottom effect
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);


  // --- 2. Žinutės Siuntimas ir Kvotos Mažinimas ---
  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading || !userId) return;
    
    // Tikriname kvotą
    if (quota !== null && quota <= 0) {
      setMessages((prevMessages) => [
        ...prevMessages,
        { id: Date.now() + 1, role: 'system', text: "Jūsų nemokamų žinučių kvota baigėsi. Prisijunkite prie Premium plano!" }
      ]);
      return;
    }

    const userMessage = { id: Date.now(), role: 'user', text: input.trim() };
    const newMessages = [...messages, userMessage];

    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      // Gauti visą pokalbio istoriją, išskyrus paskutinę vartotojo žinutę
      // Paskutinę žinutę siunčia generateGeminiContent tiesiogiai
      const historyForAPI = messages.map(msg => ({
        role: msg.role,
        text: msg.text
      }));

      // Kreipiamės į Gemini API. Naudojame TIK naują vartotojo žinutę ir SENĄ istoriją
      const { text: responseText } = await generateGeminiContent(userMessage.text, historyForAPI);
      
      const aiMessage = { id: Date.now() + 1, role: 'model', text: responseText };

      // Pridedame AI atsakymą prie esamų žinučių
      setMessages((prevMessages) => [...prevMessages, aiMessage]);

      // --- Kvotos Mažinimas Supabase ---
      if (quota > 0) {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ quota: quota - 1 })
            .eq('id', userId)
            .select();
          
          if (updateError) {
            console.error("Klaida mažinant kvotą:", updateError);
          }
          // Kvotos būsena atsinaujins per prenumeratą
      }

    } catch (error) {
      console.error("Pokalbio klaida:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        { id: Date.now() + 1, role: 'system', text: "Atsiprašau, nepavyko gauti atsakymo. Bandykite dar kartą." }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h4 className="text-white text-lg font-semibold">DI Asistentas</h4>
        <p className="text-gray-400 text-sm">Pradėk pokalbį</p>
        {/* Rodo likusią kvotą */}
        <p className="text-sm font-medium" style={{color: quota > 5 ? '#34D399' : '#FBBF24'}}>
             {quota !== null ? `Liko žinučių: ${quota}` : 'Kraunama kvota...'}
        </p>
      </div>
      
      <div className="messages-area">
        {messages.length === 0 && (
          <div className="welcome-message">
            Sveiki! Aš esu Jūsų DI Namams asistentas. Klauskite manęs apie namų priežiūrą, maisto gaminimą, pirkinių sąrašus ar bet ką, kas palengvintų Jūsų kasdienybę!
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-content">
              {msg.role === 'user' ? 'Jūs' : 'Asistentas'}
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="message model loading">
            <div className="message-content">
              Asistentas
              <Loader2 size={20} className="animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Parašykite žinutę..."
          disabled={loading || quota === 0}
          className="chat-input"
        />
        <button type="submit" disabled={loading || quota === 0} className="send-button">
          <Send size={20} />
        </button>
      </form>

      {/* Paprasti CSS stiliai, kurie veikia su Tailwind (pridedame dėl estetikos) */}
      <style>{`
        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            background-color: #1F2937; /* Gray-800 */
            border-radius: 1rem;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .chat-header {
            padding: 1rem;
            border-bottom: 1px solid #374151; /* Gray-700 */
            text-align: center;
        }
        .messages-area {
            flex-grow: 1;
            padding: 1rem;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .message {
            max-width: 80%;
            padding: 0.75rem;
            border-radius: 0.75rem;
            font-size: 0.95rem;
            word-wrap: break-word;
        }
        .message-content {
            font-size: 0.85rem;
            color: #D1D5DB; /* Gray-300 */
        }
        .user {
            align-self: flex-end;
            background-color: #10B981; /* Emerald-500 */
            color: white;
            border-bottom-right-radius: 0;
        }
        .user .message-content {
             color: white;
        }
        .model {
            align-self: flex-start;
            background-color: #374151; /* Gray-700 */
            border-bottom-left-radius: 0;
        }
        .loading {
            align-self: flex-start;
        }
        .input-area {
            display: flex;
            padding: 1rem;
            border-top: 1px solid #374151;
            background-color: #1F2937;
        }
        .chat-input {
            flex-grow: 1;
            padding: 0.75rem 1rem;
            border: 1px solid #4B5563; /* Gray-600 */
            border-radius: 0.75rem;
            background-color: #4B5563; /* Gray-600 */
            color: white;
            margin-right: 0.5rem;
        }
        .chat-input::placeholder {
            color: #D1D5DB;
        }
        .send-button {
            background-color: #059669; /* Emerald-600 */
            color: white;
            padding: 0.75rem;
            border-radius: 0.75rem;
            transition: background-color 0.2s;
        }
        .send-button:hover:not(:disabled) {
            background-color: #047857; /* Emerald-700 */
        }
        .send-button:disabled {
            background-color: #6B7280; /* Gray-500 */
            cursor: not-allowed;
        }
        .welcome-message {
            text-align: center;
            padding: 2rem;
            color: #9CA3AF; /* Gray-400 */
            background-color: #2D3748; /* Darker Gray */
            border-radius: 12px;
            margin-top: auto;
            margin-bottom: auto;
            line-height: 1.6;
        }
      `}</style>
    </div>
  );
};

export default Chat;
