
(() => {
  const CLOUD_KEYS = [
    "snapstock_purchases",
    "snapstock_pantry",
    "snapstock_shopping",
    "snapstock_category_memory"
  ];

  let sb = null;
  let currentUser = null;
  let syncTimer = null;
  let suppressSync = false;
  let initialized = false;
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  const $c = (id) => document.getElementById(id);

  function setAuthMessage(message, success=false){
    const el = $c("authMessage");
    if(!el) return;
    el.textContent = message || "";
    el.classList.toggle("success", !!success);
  }

  function setCloudStatus(text, type=""){
    const textEl=$c("cloudStatusText"), dot=$c("cloudStatusDot");
    if(textEl) textEl.textContent=text;
    if(dot){
      dot.className="cloud-dot";
      if(type) dot.classList.add(type);
    }
  }

  function collectLocalState(){
    const state={};
    CLOUD_KEYS.forEach(key=>{
      const raw=localStorage.getItem(key);
      if(raw!==null){
        try{ state[key]=JSON.parse(raw); }
        catch{ state[key]=raw; }
      }
    });
    return state;
  }

  function hasMeaningfulLocalData(){
    const s=collectLocalState();
    return Object.values(s).some(v=>{
      if(Array.isArray(v)) return v.length>0;
      if(v && typeof v==="object") return Object.keys(v).length>0;
      return !!v;
    });
  }

  function applyCloudState(state){
    suppressSync=true;
    try{
      CLOUD_KEYS.forEach(key=>{
        if(state && Object.prototype.hasOwnProperty.call(state,key)){
          const val=state[key];
          originalSetItem(key, typeof val==="string" ? val : JSON.stringify(val));
        }else{
          originalRemoveItem(key);
        }
      });
    }finally{
      suppressSync=false;
    }
    if(typeof renderHome==="function") renderHome();
    if(typeof renderBudget==="function") renderBudget();
    if(typeof renderPantry==="function") renderPantry();
    if(typeof renderShopping==="function") renderShopping();
  }

  async function loadCloudState(){
    if(!sb || !currentUser) return null;
    setCloudStatus("クラウドから読み込み中…","syncing");
    const {data,error}=await sb
      .from("app_state")
      .select("data")
      .eq("user_id",currentUser.id)
      .maybeSingle();
    if(error) throw error;
    return data?.data ?? null;
  }

  async function saveCloudState(){
    if(!sb || !currentUser || suppressSync) return;
    clearTimeout(syncTimer);
    setCloudStatus("同期中…","syncing");
    const state=collectLocalState();
    const {error}=await sb.from("app_state").upsert({
      user_id: currentUser.id,
      data: state,
      updated_at: new Date().toISOString()
    }, {onConflict:"user_id"});
    if(error){
      setCloudStatus("同期エラー","error");
      throw error;
    }
    setCloudStatus("クラウド同期済み","ok");
  }

  function scheduleSync(){
    if(!currentUser || suppressSync) return;
    clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>saveCloudState().catch(console.error),500);
  }

  function patchLocalStorage(){
    localStorage.setItem=function(key,value){
      originalSetItem(key,value);
      if(CLOUD_KEYS.includes(key)) scheduleSync();
    };
    localStorage.removeItem=function(key){
      originalRemoveItem(key);
      if(CLOUD_KEYS.includes(key)) scheduleSync();
    };
  }

  async function enterApp(user){
    currentUser=user;
    if($c("accountEmail")) $c("accountEmail").textContent=user.email||"-";

    try{
      const cloud=await loadCloudState();

      if(cloud){
        applyCloudState(cloud);
        setCloudStatus("クラウド同期済み","ok");
      }else if(hasMeaningfulLocalData()){
        await saveCloudState();
        setCloudStatus("この端末のデータをクラウドへ移行しました","ok");
      }else{
        applyCloudState({});
        await saveCloudState();
      }

      $c("authGate")?.classList.add("hidden");
    }catch(e){
      console.error(e);
      setAuthMessage("クラウドデータの読み込みに失敗しました：" + (e.message||String(e)));
      setCloudStatus("同期エラー","error");
    }
  }

  async function init(){
    try{
      const res=await fetch("/api/config",{cache:"no-store"});
      const cfg=await res.json();
      if(!cfg.ok){
        setAuthMessage("Supabaseの設定がまだ完了していません。管理者がVercelの環境変数を設定してください。");
        return;
      }

      if(!window.supabase?.createClient){
        setAuthMessage("ログインライブラリの読み込みに失敗しました。ページを再読み込みしてください。");
        return;
      }

      sb=window.supabase.createClient(
        cfg.supabase_url,
        cfg.supabase_publishable_key
      );

      patchLocalStorage();

      const {data:{session}}=await sb.auth.getSession();
      if(session?.user){
        await enterApp(session.user);
      }else{
        $c("authGate")?.classList.remove("hidden");
      }

      sb.auth.onAuthStateChange(async(event,session)=>{
        if(event==="SIGNED_OUT"){
          currentUser=null;
          $c("authGate")?.classList.remove("hidden");
          setCloudStatus("ログアウト中","");
        }
        if(event==="SIGNED_IN" && session?.user && session.user.id!==currentUser?.id){
          await enterApp(session.user);
        }
      });

      initialized=true;
    }catch(e){
      console.error(e);
      setAuthMessage("ログイン機能の初期化に失敗しました：" + (e.message||String(e)));
    }
  }

  document.addEventListener("DOMContentLoaded",()=>{
    document.querySelectorAll("[data-auth-tab]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        document.querySelectorAll("[data-auth-tab]").forEach(x=>x.classList.toggle("active",x===btn));
        const login=btn.dataset.authTab==="login";
        $c("loginForm")?.classList.toggle("hidden",!login);
        $c("signupForm")?.classList.toggle("hidden",login);
        setAuthMessage("");
      });
    });

    $c("loginForm")?.addEventListener("submit",async(e)=>{
      e.preventDefault();
      if(!sb) return setAuthMessage("ログイン機能を準備中です。");
      setAuthMessage("ログイン中…",true);
      const {error}=await sb.auth.signInWithPassword({
        email:$c("loginEmail").value.trim(),
        password:$c("loginPassword").value
      });
      if(error) setAuthMessage("ログインできませんでした：" + error.message);
    });

    $c("signupForm")?.addEventListener("submit",async(e)=>{
      e.preventDefault();
      if(!sb) return setAuthMessage("ログイン機能を準備中です。");
      const email=$c("signupEmail").value.trim();
      const pw=$c("signupPassword").value;
      const pw2=$c("signupPasswordConfirm").value;
      if(pw!==pw2) return setAuthMessage("パスワードが一致していません。");
      setAuthMessage("アカウント作成中…",true);
      const {data,error}=await sb.auth.signUp({email,password:pw});
      if(error) return setAuthMessage("新規登録できませんでした：" + error.message);
      if(data.session){
        setAuthMessage("登録しました。ログインします…",true);
      }else{
        setAuthMessage("確認メールを送信しました。メール内のリンクを開いてからログインしてください。",true);
      }
    });

    $c("accountBtn")?.addEventListener("click",()=>{
      $c("accountModal")?.classList.remove("hidden");
    });
    $c("closeAccountModal")?.addEventListener("click",()=>{
      $c("accountModal")?.classList.add("hidden");
    });
    $c("syncNowBtn")?.addEventListener("click",()=>{
      saveCloudState().catch(e=>alert("同期に失敗しました：" + e.message));
    });
    $c("logoutBtn")?.addEventListener("click",async()=>{
      if(!sb) return;
      try{ await saveCloudState(); }catch(e){}
      await sb.auth.signOut();
      $c("accountModal")?.classList.add("hidden");
    });

    init();
  });

  window.SnapStockCloud={
    sync:()=>saveCloudState(),
    getUser:()=>currentUser
  };
})();
