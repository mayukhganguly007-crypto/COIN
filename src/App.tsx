/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  Timestamp,
  runTransaction,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  Coins, 
  MapPin, 
  Bus, 
  Wallet, 
  History, 
  PlusCircle, 
  LogOut, 
  ShieldCheck,
  TrendingUp,
  Info,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  coinBalance: number;
  createdAt: Timestamp;
}

interface Submission {
  id?: string;
  userId: string;
  category: 'transport' | 'loan' | 'local_issue' | 'other';
  content: string;
  location?: { lat: number; lng: number };
  reward: number;
  status: 'pending' | 'verified' | 'rejected';
  createdAt: Timestamp;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

// --- Error Handling ---

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State
  const [category, setCategory] = useState<Submission['category']>('transport');
  const [content, setContent] = useState('');

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Sync Profile
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName,
              email: firebaseUser.email,
              coinBalance: 10, // Welcome bonus
              createdAt: Timestamp.now(),
            };
            await setDoc(userRef, newProfile);
            setProfile(newProfile);
          } else {
            setProfile(userSnap.data() as UserProfile);
          }
        } catch (err) {
          console.error("Profile sync error", err);
        }

        // Listen to Profile Changes
        const unsubProfile = onSnapshot(userRef, (doc) => {
          if (doc.exists()) setProfile(doc.data() as UserProfile);
        }, (err) => handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`));

        // Listen to Submissions
        const q = query(
          collection(db, 'submissions'),
          where('userId', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const unsubSubmissions = onSnapshot(q, (snapshot) => {
          const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Submission));
          setSubmissions(docs);
        }, (err) => handleFirestoreError(err, OperationType.LIST, 'submissions'));

        return () => {
          unsubProfile();
          unsubSubmissions();
        };
      } else {
        setProfile(null);
        setSubmissions([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError("Login failed. Please try again.");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !content.trim()) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      let location = undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => 
          navigator.geolocation.getCurrentPosition(res, rej)
        );
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch (e) {
        console.warn("Location access denied");
      }

      const reward = 5; // Base reward
      const submission: Omit<Submission, 'id'> = {
        userId: user.uid,
        category,
        content,
        location,
        reward,
        status: 'verified', // Auto-verified for demo, usually 'pending'
        createdAt: Timestamp.now(),
      };

      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await transaction.get(userRef);
        
        if (!userSnap.exists()) throw new Error("User profile not found");
        
        const currentBalance = userSnap.data().coinBalance || 0;
        
        // Add submission
        const subRef = doc(collection(db, 'submissions'));
        transaction.set(subRef, submission);
        
        // Update balance
        transaction.update(userRef, {
          coinBalance: currentBalance + reward
        });

        // Add transaction record
        const transRef = doc(collection(db, 'transactions'));
        transaction.set(transRef, {
          userId: user.uid,
          amount: reward,
          type: 'earning',
          description: `Earned for ${category} info`,
          createdAt: Timestamp.now()
        });
      });

      setSuccess(`Success! You earned ${reward} e-coins.`);
      setContent('');
    } catch (err) {
      console.error(err);
      setError("Failed to submit information. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 overflow-hidden relative">
        {/* Background Gradients */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-2xl text-center space-y-8"
        >
          <div className="flex justify-center">
            <div className="p-4 bg-emerald-500/10 rounded-3xl border border-emerald-500/20">
              <Coins className="w-16 h-16 text-emerald-500" />
            </div>
          </div>
          
          <div className="space-y-4">
            <h1 className="text-6xl font-bold tracking-tighter bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent">
              Coin & Citizen
            </h1>
            <p className="text-xl text-zinc-400 max-w-lg mx-auto leading-relaxed">
              Turn your real-time insights into future wealth. Help your city and earn e-coins redeemable for crypto.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            {[
              { icon: Bus, title: "Transport", desc: "Report delays or traffic" },
              { icon: Wallet, title: "Finance", desc: "Share loan insights" },
              { icon: AlertCircle, title: "Issues", desc: "Report local problems" }
            ].map((item, i) => (
              <div key={i} className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                <item.icon className="w-6 h-6 text-emerald-500 mb-2" />
                <h3 className="font-semibold">{item.title}</h3>
                <p className="text-xs text-zinc-500">{item.desc}</p>
              </div>
            ))}
          </div>

          <button 
            onClick={handleLogin}
            className="group relative px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-2xl transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto"
          >
            <ShieldCheck className="w-5 h-5" />
            Start Earning Now
          </button>
          
          <p className="text-sm text-zinc-600">
            Secure authentication via Google. No private data shared.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-white/5 px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <Coins className="w-6 h-6 text-emerald-500" />
            </div>
            <span className="text-xl font-bold tracking-tight">Coin & Citizen</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
              <Wallet className="w-4 h-4 text-emerald-500" />
              <span className="font-mono font-bold text-emerald-500">
                {profile?.coinBalance.toLocaleString()} <span className="text-[10px] text-zinc-500 uppercase tracking-widest ml-1">e-coins</span>
              </span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-500 hover:text-white"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Actions */}
        <div className="lg:col-span-7 space-y-8">
          {/* Stats Card */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-6 bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 rounded-3xl">
              <TrendingUp className="w-5 h-5 text-emerald-500 mb-4" />
              <div className="text-3xl font-bold mb-1">{profile?.coinBalance}</div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">Total Accumulated</div>
            </div>
            <div className="p-6 bg-white/5 border border-white/10 rounded-3xl">
              <History className="w-5 h-5 text-blue-500 mb-4" />
              <div className="text-3xl font-bold mb-1">{submissions.length}</div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">Reports Contributed</div>
            </div>
          </div>

          {/* Submission Form */}
          <section className="p-8 bg-white/5 border border-white/10 rounded-[2rem] relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <PlusCircle className="w-24 h-24" />
            </div>
            
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
              <MapPin className="text-emerald-500" />
              Submit Real-time Info
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(['transport', 'loan', 'local_issue', 'other'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      "px-4 py-3 rounded-2xl text-sm font-semibold capitalize transition-all border",
                      category === cat 
                        ? "bg-emerald-500 text-black border-emerald-500 shadow-lg shadow-emerald-500/20" 
                        : "bg-white/5 text-zinc-400 border-white/10 hover:border-white/20"
                    )}
                  >
                    {cat.replace('_', ' ')}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Information Details</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe what's happening... (e.g., 'Bus 42 is delayed by 15 mins at Central St')"
                  className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none"
                  required
                />
              </div>

              <AnimatePresence mode="wait">
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </motion.div>
                )}
                {success && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {success}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-2xl transition-all flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    <PlusCircle className="w-5 h-5" />
                    Submit & Earn 5 e-coins
                  </>
                )}
              </button>
            </form>
          </section>
        </div>

        {/* Right Column: History & Info */}
        <div className="lg:col-span-5 space-y-8">
          {/* Crypto Conversion Info */}
          <div className="p-6 bg-blue-500/10 border border-blue-500/20 rounded-3xl">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-500/20 rounded-2xl">
                <Info className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-1">Future Conversion</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Accumulate e-coins now. In <span className="text-blue-400 font-bold">2028</span>, your balance will be convertible to <span className="text-blue-400 font-bold">CITIZEN Token</span> on the Ethereum network.
                </p>
                <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-blue-400/60 uppercase tracking-tighter">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  Accumulation Phase Active
                </div>
              </div>
            </div>
          </div>

          {/* History */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold px-2 flex items-center gap-2">
              <History className="w-4 h-4 text-zinc-500" />
              Recent Activity
            </h2>
            
            <div className="space-y-3">
              {submissions.length === 0 ? (
                <div className="p-8 text-center bg-white/5 border border-dashed border-white/10 rounded-3xl">
                  <p className="text-sm text-zinc-500">No submissions yet. Start earning!</p>
                </div>
              ) : (
                submissions.map((sub) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={sub.id}
                    className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between group hover:bg-white/[0.07] transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "p-2 rounded-xl",
                        sub.category === 'transport' ? "bg-blue-500/10 text-blue-400" :
                        sub.category === 'loan' ? "bg-emerald-500/10 text-emerald-400" :
                        "bg-zinc-500/10 text-zinc-400"
                      )}>
                        {sub.category === 'transport' ? <Bus className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium line-clamp-1">{sub.content}</p>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {format(sub.createdAt.toDate(), 'MMM d, HH:mm')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-emerald-500">+{sub.reward}</div>
                      <div className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">e-coins</div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto p-12 text-center text-zinc-600">
        <p className="text-xs uppercase tracking-[0.2em] font-bold">Empowering Citizens through Data Sovereignty</p>
      </footer>
    </div>
  );
}
