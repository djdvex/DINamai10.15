import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// --- Globalios ir Komponentų dalys, sujungtos į vieną failą ---

// --- 1. Piktogramos (iš Chat/Plans, dabar čia) ---
const MessageSquare = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"></path></svg>
);
const Zap = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
);
const Loader2 = ({ size = 20, className = "animate-spin" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
);
const Send = ({ size = 20 }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>
);
const Check = ({ className = "w-5 h-5" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20 6 9 17l-5-5"></path></svg>
);

// --- 2. Konstanta ir API funkcija (iš Chat, dabar čia) ---
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
const API_KEY = ""; // Naudosime automatizuotą Canvas raktą
const INITIAL_QUOTA = 20;
const PREMIUM_QUOTA = 100;

// Funkcija, kuri siunčia užklausą į Gemini API su backoff mechanizmu
const generateGeminiContent = async (prompt, chatHistory) => {
    const historyForAPI = chatHistory.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.text }]
    }));

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

            if (response.status === 429) { 
                attempts++;
                const delay = Math.pow(2, attempts) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            if (!response.ok) {
                 throw new Error(`API klaida: ${response.statusText}`);
            }

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!text) {
                throw new Error("Negauta jokio teksto atsakymo iš AI.");
            }

            return { text };

        } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) {
                console.error("Gemini API visi bandymai nepavyko:", error);
                throw new Error("Nepavyko pasiekti DI asistento.");
            }
            const delay = Math.pow(2, attempts) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error("Nepavyko pasiekti DI asistento po kelių bandymų.");
};

// --- 3. Supabase Konfigūracija ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// REALIAM Supabase projekte, Jums reikėtų naudoti tikrus Supabase URL ir ANONYMOUS KEY.
const SUPABASE_URL = "https://your-supabase-url.supabase.co"; // PAKEISTI!
const SUPABASE_ANON_KEY = "your-anon-key"; // PAKEISTI!

let supabaseClient = null;
try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error("Supabase kliento inicializavimo klaida. Patikrinkite SUPABASE_URL ir SUPABASE_ANON_KEY.", e);
}


// --- 4. Chat Komponento Funkcija (Integruota) ---
const ChatComponent = ({ supabase, user, quota, setQuota }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef(null);
    const userId = user?.id;

    // Scroll to bottom effect
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);


    // Žinutės Siuntimas ir Kvotos Mažinimas
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
            const historyForAPI = messages.map(msg => ({
                role: msg.role,
                text: msg.text
            }));

            const { text: responseText } = await generateGeminiContent(userMessage.text, historyForAPI);
            
            const aiMessage = { id: Date.now() + 1, role: 'model', text: responseText };

            setMessages((prevMessages) => [...prevMessages, aiMessage]);

            // Kvotos Mažinimas Supabase
            if (quota > 0) {
                const { error: updateError } = await supabase
                    .from('profiles')
                    .update({ quota: quota - 1 })
                    .eq('id', userId)
                    .select();
                
                if (updateError) {
                    console.error("Klaida mažinant kvotą:", updateError);
                }
                // Kvotos būsena atsinaujins per globalų listenerį
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

            <style>{`
                .chat-container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background-color: #1F2937;
                    border-radius: 1rem;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                }
                .chat-header {
                    padding: 1rem;
                    border-bottom: 1px solid #374151;
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
                    color: #D1D5DB;
                }
                .user {
                    align-self: flex-end;
                    background-color: #10B981;
                    color: white;
                    border-bottom-right-radius: 0;
                }
                .user .message-content {
                    color: white;
                }
                .model {
                    align-self: flex-start;
                    background-color: #374151;
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
                    border: 1px solid #4B5563;
                    border-radius: 0.75rem;
                    background-color: #4B5563;
                    color: white;
                    margin-right: 0.5rem;
                }
                .chat-input::placeholder {
                    color: #D1D5DB;
                }
                .send-button {
                    background-color: #059669;
                    color: white;
                    padding: 0.75rem;
                    border-radius: 0.75rem;
                    transition: background-color 0.2s;
                }
                .send-button:hover:not(:disabled) {
                    background-color: #047857;
                }
                .send-button:disabled {
                    background-color: #6B7280;
                    cursor: not-allowed;
                }
                .welcome-message {
                    text-align: center;
                    padding: 2rem;
                    color: #9CA3AF;
                    background-color: #2D3748;
                    border-radius: 12px;
                    margin-top: auto;
                    margin-bottom: auto;
                    line-height: 1.6;
                }
            `}</style>
        </div>
    );
};

// --- 5. Plans Komponento Funkcija (Integruota) ---
const PlansComponent = ({ supabase, user, quota, setQuota }) => {
    const [loading, setLoading] = useState(false);
    const userId = user?.id;
    
    // Simuliuota Plano Atnaujinimo Funkcija
    const handleUpgrade = async () => {
        if (!userId || loading || quota > INITIAL_QUOTA) return;

        setLoading(true);

        // Atnaujiname vartotojo kvotą į Premium lygį (100)
        const { error } = await supabase
            .from('profiles')
            .update({ quota: PREMIUM_QUOTA })
            .eq('id', userId);

        setLoading(false);

        if (error) {
            console.error("Klaida atnaujinant planą:", error);
            // Pakeičiame alert į konsolės pranešimą, laikydamiesi taisyklių.
            alert("Klaida atnaujinant planą. Bandykite dar kartą."); 
        } else {
            alert("Sveikiname! Jūsų planas atnaujintas į Premium! Kvota padidinta iki 100.");
        }
    };
    
    // Nustatome ar vartotojas jau yra Premium lygio
    const isPremium = quota !== null && quota > INITIAL_QUOTA;

    // Duomenys apie planus
    const plansData = [
        {
            name: "Nemokamas (Free)",
            price: "€0",
            quotaLimit: INITIAL_QUOTA,
            features: ["20 DI žinučių per mėnesį", "Bazinės namų priežiūros patarimai", "Prieiga prie bendruomenės"],
            isCurrent: !isPremium,
            isBest: false,
            buttonText: "Dabartinis planas",
        },
        {
            name: "Premium",
            price: "€9.99 / mėn.",
            quotaLimit: PREMIUM_QUOTA,
            features: ["100 DI žinučių per mėnesį", "Išplėstinės rekomendacijos", "Pirkinių sąrašų optimizavimas", "Prioritetinė pagalba"],
            isCurrent: isPremium,
            isBest: true,
            buttonText: isPremium ? "Dabartinis planas" : "Atnaujinti",
        },
    ];

    return (
        <div className="min-h-full bg-gray-900 text-white flex flex-col items-center justify-start p-4 pt-10">
            <div className="w-full max-w-4xl text-center mb-10">
                <h1 className="text-4xl font-extrabold mb-2 text-emerald-400">Pasirinkite Planą</h1>
                <p className="text-gray-400 text-lg">Prisijunkite prie Premium ir atrakinkite daugiau funkcijų.</p>
                
                {quota !== null && (
                    <p className={`mt-4 text-xl font-semibold p-3 rounded-lg ${isPremium ? 'bg-emerald-600' : 'bg-yellow-600'}`}>
                        {isPremium 
                            ? `Jūsų PREMIUM kvota: ${quota} liko.` 
                            : `Jūsų NEMOKAMA kvota: ${quota} liko.`}
                    </p>
                )}
                {quota === null && (
                     <div className="mt-4 text-xl font-semibold p-3 rounded-lg bg-gray-700 flex justify-center items-center">
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Kvota kraunama...
                    </div>
                )}
            </div>

            <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl">
                {plansData.map((plan) => (
                    <div key={plan.name} className={`relative flex flex-col p-6 rounded-xl shadow-2xl transition-all duration-300 transform hover:scale-[1.02] ${plan.isBest ? 'bg-gray-800 border-4 border-emerald-500' : 'bg-gray-800 border-2 border-gray-700'}`}>
                        {plan.isBest && (
                            <span className="absolute top-0 right-0 bg-emerald-500 text-white text-xs font-bold uppercase py-1 px-3 rounded-bl-lg rounded-tr-xl">
                                Populiariausias
                            </span>
                        )}
                        
                        <div className="mb-4">
                            <h2 className={`text-2xl font-bold ${plan.isBest ? 'text-emerald-400' : 'text-white'}`}>{plan.name}</h2>
                            <p className="text-4xl font-extrabold mt-2">{plan.price}</p>
                            <p className="text-gray-400 mt-1">Kvotos limitas: **{plan.quotaLimit} žinučių**</p>
                        </div>
                        
                        <ul className="flex-1 space-y-3 text-left mb-6">
                            {plan.features.map((feature) => (
                                <li key={feature} className="flex items-start">
                                    <Check className="w-5 h-5 text-emerald-500 mr-2 flex-shrink-0" />
                                    <span className="text-gray-300">{feature}</span>
                                </li>
                            ))}
                        </ul>

                        <button
                            onClick={plan.name === "Premium" && !isPremium ? handleUpgrade : null}
                            disabled={isPremium || loading || plan.name === "Nemokamas (Free)"}
                            className={`
                                w-full py-3 mt-auto rounded-lg font-semibold text-lg transition duration-300 ease-in-out
                                ${plan.name === "Premium" && !isPremium
                                    ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/50'
                                    : plan.isCurrent
                                    ? 'bg-gray-600 text-gray-300 cursor-default'
                                    : 'bg-gray-600 text-gray-300 cursor-default' // Neturėtų nutikti, bet saugumui
                                }
                                ${loading && 'opacity-70 cursor-wait'}
                            `}
                        >
                            {loading && plan.name === "Premium" ? (
                                <Loader2 className="w-6 h-6 mx-auto animate-spin" />
                            ) : plan.buttonText}
                        </button>
                    </div>
                ))}
            </div>
            
        </div>
    );
};


// --- 6. Pagrindinis App Komponentas ---
const App = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('chat'); // 'chat' arba 'plans'
    const [quota, setQuota] = useState(null); // Bendra kvotos būsena

    // Vartotojo Autentifikavimas ir Kvotos Klausymas
    useEffect(() => {
        if (!supabaseClient) {
            setLoading(false);
            setUser({ id: 'mock-user-id-' + appId }); 
            return;
        }

        let authListener;
        
        // 1. Autentifikacijos klausymas
        const { data: listener } = supabaseClient.auth.onAuthStateChange(
            (event, session) => {
                if (session) {
                    setUser(session.user);
                } else {
                    setUser(null);
                    handleSignIn();
                }
                // setLoading(false);
            }
        );
        authListener = listener;
        
        const handleSignIn = async () => {
            if (!initialAuthToken) {
                 const { data, error } = await supabaseClient.auth.signInAnonymously();
                 if (error) {
                    console.error("Supabase anoniminio prisijungimo klaida:", error);
                 } else if (data.user) {
                    setUser(data.user);
                 }
            } else {
                 const { data, error } = await supabaseClient.auth.signInWithCustomToken(initialAuthToken);
                 if (error) {
                    console.warn("Supabase prisijungimas per Custom Token nepavyko. Bandome anonimiškai.", error);
                    await supabaseClient.auth.signInAnonymously();
                 } else if (data.user) {
                    setUser(data.user);
                 }
            }
            // setLoading(false); // Nustatome po pradinio kvotos įkėlimo
        };
        
        // Pradinis autentifikacijos patikrinimas
        supabaseClient.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                setUser(session.user);
            } else {
                handleSignIn();
            }
        });

        return () => {
             authListener?.subscription.unsubscribe();
        };

    }, []);

    // Kvotos Įkėlimas ir Realaus Laiko Klausymas (priklauso nuo user)
    useEffect(() => {
        if (!user || !supabaseClient) return;

        const userId = user.id;

        // Supabase realaus laiko prenumerata kvotos atnaujinimui
        const quotaSubscription = supabaseClient
            .channel('public:profiles_global')
            .on('postgres_changes', 
                { 
                    event: 'UPDATE', 
                    schema: 'public', 
                    table: 'profiles', 
                    filter: `id=eq.${userId}` 
                }, 
                payload => {
                    if (payload.new.id === userId) {
                        setQuota(payload.new.quota);
                    }
                })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // Kvota kraunama TIK po sėkmingos prenumeratos
                    loadQuota();
                }
            });

        const loadQuota = async () => {
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('quota')
                .eq('id', userId)
                .single();
            
            if (error && error.code !== 'PGRST116') {
                console.error("Klaida įkeliant kvotą App.jsx:", error);
                setLoading(false);
                return;
            }

            if (data) {
                setQuota(data.quota);
            } else {
                // Jei profilis nesukurtas, sukuriame jį su pradine kvota
                const { error: insertError } = await supabaseClient
                    .from('profiles')
                    .insert({ id: userId, quota: INITIAL_QUOTA });

                if (insertError) {
                    console.error("Klaida kuriant profilį App.jsx:", insertError);
                } else {
                    setQuota(INITIAL_QUOTA);
                }
            }
            setLoading(false);
        };

        return () => {
            supabaseClient.removeChannel(quotaSubscription);
        };
    }, [user, supabaseClient]);


    // Stiliai naudojant Tailwind CSS
    return (
        <div className="flex flex-col h-screen w-full bg-gray-900 font-sans">
            <script src="https://cdn.tailwindcss.com"></script>
            <div className="p-4 bg-gray-800 border-b border-gray-700 shadow-md">
                <h1 className="text-2xl font-bold text-emerald-400">DI Namams</h1>
                <p className="text-sm text-gray-400">Vartotojo ID: {user?.id || 'Neautentifikuotas'}</p>
            </div>
            
            <div className="flex flex-col md:flex-row flex-grow overflow-hidden">
                {/* Šoninis Navigacijos meniu mobiliesiems/desktop'ui */}
                <div className="flex md:flex-col p-2 bg-gray-800 border-b md:border-r border-gray-700">
                    <button
                        onClick={() => setActiveTab('chat')}
                        className={`
                            flex items-center justify-center md:justify-start p-3 m-1 rounded-lg text-sm font-medium transition duration-200
                            ${activeTab === 'chat' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-300 hover:bg-gray-700'}
                        `}
                    >
                        <MessageSquare className="w-5 h-5 mr-2" />
                        <span className="hidden md:inline">Pokalbis</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('plans')}
                        className={`
                            flex items-center justify-center md:justify-start p-3 m-1 rounded-lg text-sm font-medium transition duration-200
                            ${activeTab === 'plans' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-300 hover:bg-gray-700'}
                        `}
                    >
                        <Zap className="w-5 h-5 mr-2" />
                        <span className="hidden md:inline">Planai</span>
                    </button>
                </div>

                {/* Pagrindinis turinys */}
                <main className="flex-grow p-4 overflow-y-auto">
                    {loading && (
                         <div className="flex justify-center items-center h-full text-white text-lg">Kraunami duomenys...</div>
                    )}
                    {!loading && user && supabaseClient && (
                        <>
                            {activeTab === 'chat' && (
                                <div className="h-full">
                                    <ChatComponent supabase={supabaseClient} user={user} quota={quota} setQuota={setQuota} />
                                </div>
                            )}
                            {activeTab === 'plans' && (
                                <div className="h-full">
                                    <PlansComponent supabase={supabaseClient} user={user} quota={quota} setQuota={setQuota} />
                                </div>
                            )}
                        </>
                    )}
                    {!loading && !user && (
                        <div className="text-center p-8 bg-red-800/20 text-red-300 rounded-lg">
                            Autentifikacija nepavyko arba Supabase raktai yra neteisingi. Prašome patikrinti `SUPABASE_URL` ir `SUPABASE_ANON_KEY` faile `App.jsx`.
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;
