import React, { useState, useEffect, useRef, useCallback } from 'react';
// Supabase dabar bus importuojamas per CDN, o ne kaip paketas. 
// Ši eilutė yra nereikalinga, bet paliekame, kad būtų aišku:
// import { createClient } from '@supabase/supabase-js'; 

// --- Globalios ir Komponentų dalys, sujungtos į vieną failą ---

// --- 1. Piktogramos ---
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

// --- 2. Konstanta ir API funkcija (Gemini) ---
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
const API_KEY = ""; // Naudosime automatizuotą Canvas raktą (palikti tuščią!)
const INITIAL_QUOTA = 20;
const PREMIUM_QUOTA = 100;

// Funkcija, kuri siunčia užklausą į Gemini API su backoff mechanizmu
const generateGeminiContent = async (prompt, chatHistory) => {
    // API reikalavimai: Role gali būti tik 'user' arba 'model'
    const historyForAPI = chatHistory
        .filter(msg => msg.role !== 'system') // Išmetame sistemos žinutes (pvz., kvota baigėsi)
        .map(msg => ({
            role: msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.text }]
        }));

    const contents = [
        ...historyForAPI, 
        { role: 'user', parts: [{ text: prompt }] }
    ];

    const payload = {
        contents: contents,
        systemInstruction: {
            parts: [{ text: "Jūs esate draugiškas, profesionalus DI Namams asistentas, naudojantis Google Gemini. Atsakinėkite trumpai ir aiškiai apie buitį, pirkinius, maisto gaminimą ir namų priežiūrą. Atsakykite tik lietuviškai." }]
        },
    };

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        try {
            const url = `${GEMINI_API_URL}${API_KEY}`;
            const response = await fetch(url, {
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
                 const errorBody = await response.text();
                 console.error("Gemini API klaida atsake:", errorBody);
                 throw new Error(`Gemini API klaida: ${response.statusText}`);
            }

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!text) {
                console.warn("Gemini atsakymas negautas (galbūt filtravimas):", result);
                throw new Error("Negauta jokio teksto atsakymo iš Gemini DI.");
            }

            return { text };

        } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) {
                console.error("Gemini API visi bandymai nepavyko:", error);
                throw new Error("Nepavyko pasiekti Gemini DI asistento.");
            }
            const delay = Math.pow(2, attempts) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error("Nepavyko pasiekti Gemini DI asistento po kelių bandymų.");
};

// --- 3. Supabase Konfigūracija ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Pakeiskite šias vietas į TIKRUS SUPABASE URL IR KEY.
const SUPABASE_URL = "https://your-supabase-url.supabase.co"; 
const SUPABASE_ANON_KEY = "your-anon-key"; 

// Dinaminis Supabase kliento gavimas iš globalaus lango objekto po CDN įkėlimo
let supabaseClient = null;

try {
    // Tikriname, ar nustatymai nėra pavyzdiniai
    if (SUPABASE_URL.includes("your-supabase-url") || SUPABASE_ANON_KEY.includes("your-anon-key")) {
        console.error("DĖMESIO: Supabase URL/Key yra pavyzdiniai. Prašome juos pakeisti.");
    } else {
        // Tikriname, ar createClient funkcija prieinama per CDN
        if (window.supabase && window.supabase.createClient) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else {
            // Reikalinga atsarginė funkcija, jei CDN importas dar neįvyko arba nepasiekiamas
            // Jei vykdymas vyksta po visiško įkėlimo, galima tiesiog naudoti createClient()
            console.error("Supabase createClient funkcija nerasta 'window.supabase'. Patikrinkite CDN.");
        }
    }
} catch (e) {
    console.error("Supabase kliento inicializavimo klaida:", e);
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
        if (!input.trim() || loading || !userId || !supabase) return; // Pridėtas patikrinimas, ar supabase prieinamas
        
        // Tikriname kvotą
        if (quota !== null && quota <= 0) {
            setMessages((prevMessages) => [
                ...prevMessages,
                { id: Date.now() + 1, role: 'system', text: "Jūsų nemokamų žinučių kvota baigėsi. Prisijunkite prie Premium plano!" }
            ]);
            setInput('');
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

            // Iškviečiame Gemini API
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
                    console.error("Klaida mažinant kvotą Supabase:", updateError);
                }
            }

        } catch (error) {
            console.error("Pokalbio klaida:", error);
            setMessages((prevMessages) => [
                ...prevMessages,
                { id: Date.now() + 1, role: 'system', text: "Atsiprašau, nepavyko gauti atsakymo iš DI. Patikrinkite Supabase nustatymus ir API ryšį." }
            ]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="chat-container">
            <div className="chat-header">
                <h4 className="text-white text-lg font-semibold">Gemini DI Asistentas</h4>
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
        if (!userId || loading || quota > INITIAL_QUOTA || !supabase) return;

        setLoading(true);

        // Atnaujiname vartotojo kvotą į Premium lygį (100)
        const { error } = await supabase
            .from('profiles')
            .update({ quota: PREMIUM_QUOTA })
            .eq('id', userId);

        setLoading(false);

        if (error) {
            console.error("Klaida atnaujinant planą Supabase:", error);
            // Pakeičiame alert į konsolės pranešimą.
             alert("Klaida atnaujinant planą. Patikrinkite Supabase konsolės klaidas."); 
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
                                    : 'bg-gray-600 text-gray-300 cursor-default'
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

    // Funkcija, kuri inicijuoja Supabase kliento gavimą
    const getSupabaseClient = useCallback(() => {
        if (window.supabase && window.supabase.createClient && !supabaseClient) {
            try {
                if (SUPABASE_URL.includes("your-supabase-url") || SUPABASE_ANON_KEY.includes("your-anon-key")) {
                    console.error("DĖMESIO: Supabase URL/Key yra pavyzdiniai. Prašome juos pakeisti.");
                    return null;
                }
                // Nustatome globalų kliento kintamąjį, kad visi komponentai jį matytų
                return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            } catch (e) {
                console.error("Supabase kliento inicializavimo klaida per getSupabaseClient:", e);
                return null;
            }
        }
        return supabaseClient;
    }, []);

    // Vartotojo Autentifikavimas ir Kvotos Klausymas
    useEffect(() => {
        const client = getSupabaseClient();
        if (!client) {
            // Jei negalime gauti kliento (dėl pavyzdinių raktų arba neįkeltos bibliotekos)
            setLoading(false);
            setUser({ id: 'mock-user-id-' + appId }); 
            return;
        }

        let authListener;
        
        // 1. Autentifikacijos klausymas
        const { data: listener } = client.auth.onAuthStateChange(
            (event, session) => {
                if (session) {
                    setUser(session.user);
                } else {
                    setUser(null);
                    handleSignIn(client);
                }
            }
        );
        authListener = listener;
        
        const handleSignIn = async (sbClient) => {
            if (!initialAuthToken) {
                 const { data, error } = await sbClient.auth.signInAnonymously();
                 if (error) {
                    console.error("Supabase anoniminio prisijungimo klaida:", error);
                 } else if (data.user) {
                    setUser(data.user);
                 }
            } else {
                 const { data, error } = await sbClient.auth.signInWithCustomToken(initialAuthToken);
                 if (error) {
                    console.warn("Supabase prisijungimas per Custom Token nepavyko. Bandome anonimiškai.", error);
                    await sbClient.auth.signInAnonymously();
                 } else if (data.user) {
                    setUser(data.user);
                 }
            }
        };
        
        // Pradinis autentifikacijos patikrinimas
        client.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                setUser(session.user);
            } else {
                handleSignIn(client);
            }
        });

        return () => {
             authListener?.subscription.unsubscribe();
        };

    }, [getSupabaseClient]);

    // Kvotos Įkėlimas ir Realaus Laiko Klausymas (priklauso nuo user)
    useEffect(() => {
        const client = getSupabaseClient();
        if (!user || !client) return;

        const userId = user.id;

        // Supabase realaus laiko prenumerata kvotos atnaujinimui
        const quotaSubscription = client
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
                    loadQuota(client);
                }
            });

        const loadQuota = async (sbClient) => {
            const { data, error } = await sbClient
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
                const { error: insertError } = await sbClient
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
            if (quotaSubscription) {
                client.removeChannel(quotaSubscription);
            }
        };
    }, [user, getSupabaseClient]);


    // Stiliai naudojant Tailwind CSS
    const client = getSupabaseClient();
    
    return (
        <div className="flex flex-col h-screen w-full bg-gray-900 font-sans">
            {/* Supabase CDN importas, kad išspręstume 'Could not resolve' klaidą */}
            <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
            <script src="https://cdn.tailwindcss.com"></script>

            <div className="p-4 bg-gray-800 border-b border-gray-700 shadow-md">
                <h1 className="text-2xl font-bold text-emerald-400">DI Namams</h1>
                <p className="text-sm text-gray-400">Vartotojo ID: {user?.id || 'Kraunamas...'} | DI Modelis: **Google Gemini**</p>
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
                         <div className="flex justify-center items-center h-full text-white text-lg">
                            <Loader2 className="w-6 h-6 mr-2 animate-spin" /> Kraunami duomenys...
                        </div>
                    )}
                    {!loading && user && client && (
                        <>
                            {activeTab === 'chat' && (
                                <div className="h-full">
                                    <ChatComponent supabase={client} user={user} quota={quota} setQuota={setQuota} />
                                </div>
                            )}
                            {activeTab === 'plans' && (
                                <div className="h-full">
                                    <PlansComponent supabase={client} user={user} quota={quota} setQuota={setQuota} />
                                </div>
                            )}
                        </>
                    )}
                    {!loading && !client && user && (
                        <div className="text-center p-8 bg-red-800/20 text-red-300 rounded-lg">
                            Klaida: Neteisingi Supabase raktai arba inicializacija. Prašome pakeisti pavyzdinius URL ir Key kintamuosius `SUPABASE_URL` ir `SUPABASE_ANON_KEY` faile `App.jsx`. **Supabase kvotų sistema neveiks.**
                        </div>
                    )}
                     {!loading && !user && (
                        <div className="text-center p-8 bg-red-800/20 text-red-300 rounded-lg">
                            Autentifikacija nepavyko. DI asistentas veiks, bet kvotos sistema bus išjungta.
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;
