import React, { useState } from 'react'
import { supabase } from '../supabaseClient.js'

export default function Auth(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true); setMsg('')
    try{
      if(isSignUp){
        const { error } = await supabase.auth.signUp({ email, password })
        if(error) throw error
        setMsg('Check email to confirm sign up.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if(error) throw error
        setMsg('Logged in.')
      }
    }catch(err){
      setMsg(err.message)
    }finally{ setLoading(false) }
  }

  const google = async ()=>{
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
    if(error) setMsg(error.message)
  }

  return (
    <div className="app-root">
      <div className="card" style={{maxWidth:480,margin:'40px auto'}}>
        <h3>{isSignUp ? 'Sign up' : 'Sign in'}</h3>
        <form onSubmit={handleSubmit} style={{display:'grid',gap:8}}>
          <input className="input" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
          <div style={{display:'flex',gap:8}}>
            <button className="btn" disabled={loading}>{isSignUp ? 'Create' : 'Login'}</button>
            <button type="button" className="btn" onClick={google}>Google</button>
          </div>
        </form>
        <p style={{marginTop:10}}><button onClick={()=>setIsSignUp(s=>!s)} className="btn">{isSignUp ? 'Back to login' : 'Create account'}</button></p>
        {msg && <p style={{marginTop:10,color:'#ffd'}}> {msg} </p>}
      </div>
    </div>
  )
}
