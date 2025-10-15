import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Auth from './components/Auth.jsx'
import Chat from './components/Chat.jsx'

export default function App(){
  const [session, setSession] = useState(null)

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=> setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return ()=> listener.subscription.unsubscribe()
  },[])

  return session?.user ? <Chat /> : <Auth />
}
