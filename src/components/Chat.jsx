import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

export default function Chat(){
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [remaining, setRemaining] = useState(0)

  useEffect(()=>{
    async function loadQuota(){
      const s = await supabase.auth.getSession()
      const userId = s.data?.session?.user?.id
      if(!userId) return
      const res = await fetch('/api/quota?userId='+userId)
      if(res.ok){ const j = await res.json(); setRemaining(j.remaining || 0) }
    }
    loadQuota()
  },[])

  const send = async ()=>{
    if(!input) return
    const s = await supabase.auth.getSession()
    const userId = s.data?.session?.user?.id
    const res = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:input,userId})})
    const j = await res.json()
    if(j.error) alert(j.error)
    else { setMessages(prev=>[...prev,{from:'ai',text:j.text}]); setRemaining(j.remaining) }
    setInput('')
  }

  const logout = async ()=>{ await supabase.auth.signOut(); window.location.reload() }

  return (
    <div className="app-root">
      <div className="header card">
        <div>DI Namams</div>
        <div><button className="btn" onClick={logout}>Logout</button></div>
      </div>

      <div style={{display:'flex',gap:12,marginTop:12}}>
        <div style={{flex:1}} className="card">
          <div style={{minHeight:360}}>
            {messages.map((m,i)=>(<div key={i}><b>{m.from}:</b> {m.text}</div>))}
          </div>
          <div style={{marginTop:8,display:'flex',gap:8}}>
            <input className="input" value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask..." />
            <button className="btn" onClick={send}>Send</button>
          </div>
        </div>
        <div style={{width:320}} className="card">
          <h4>Quota</h4>
          <div>Remaining: {remaining}</div>
        </div>
      </div>
    </div>
  )
}
