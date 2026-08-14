
const CATEGORIES = ["食費","日用品","飲料","調味料","その他"];
const screens=[...document.querySelectorAll(".screen")];
const navButtons=[...document.querySelectorAll(".nav-btn")];
let editorItems=[], selectedImage=null, printedReceiptTotal=null, lastOcrConfidence=null, receiptTaxMode='included';
let receiptSessionId=0;
let activeOcrController=null;
let budgetCategory="すべて", pantryCategory="すべて", pantryStock="all", shoppingCategory="すべて";
let pantryExpiry="all";
let budgetViewDate=new Date();
budgetViewDate=new Date(budgetViewDate.getFullYear(),budgetViewDate.getMonth(),1);

const data={
  get purchases(){return JSON.parse(localStorage.getItem("snapstock_purchases")||"[]")},
  set purchases(v){localStorage.setItem("snapstock_purchases",JSON.stringify(v))},
  get pantry(){return JSON.parse(localStorage.getItem("snapstock_pantry")||"[]")},
  set pantry(v){localStorage.setItem("snapstock_pantry",JSON.stringify(v))},
  get shopping(){return JSON.parse(localStorage.getItem("snapstock_shopping")||"[]")},
  set shopping(v){localStorage.setItem("snapstock_shopping",JSON.stringify(v))},
  get categoryMemory(){return JSON.parse(localStorage.getItem("snapstock_category_memory")||"{}")},
  set categoryMemory(v){localStorage.setItem("snapstock_category_memory",JSON.stringify(v))}
};

const $=id=>document.getElementById(id);
function uid(){return crypto.randomUUID?.()||String(Date.now()+Math.random())}
function yen(n){return new Intl.NumberFormat("ja-JP",{style:"currency",currency:"JPY",maximumFractionDigits:0}).format(Number(n||0))}
function todayISO(){return new Date().toISOString().slice(0,10)}
function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function norm(name){return String(name||"").toLowerCase().replace(/\s+/g,"").replace(/[0-9０-９]+/g,"").replace(/[()（）\[\]【】]/g,"").trim()}
function canonical(name){
  const n=String(name||"").trim();
  const rules=[
    [/たまご|卵|タマゴ/,"卵"],[/牛乳|ミルク/,"牛乳"],[/若鶏.*ムネ|鶏.*むね|ムネ肉/,"鶏むね肉"],
    [/若鶏.*モモ|鶏.*もも|モモ肉/,"鶏もも肉"],[/じゃが|馬鈴薯|ジャガ/,"じゃがいも"],[/玉ねぎ|たまねぎ|タマネギ/,"玉ねぎ"],
    [/長ねぎ|長ネギ|ナガネギ/,"長ねぎ"],[/キャベツ/,"キャベツ"],[/レタス/,"レタス"],[/ブロッコリー/,"ブロッコリー"],
    [/きゅうり|キュウリ/,"きゅうり"],[/れんこん|レンコン/,"れんこん"],[/えのき|エノキ/,"えのき"],[/食パン|パン/,"食パン"],
    [/味噌|みそ/,"味噌"],[/醤油|しょうゆ/,"醤油"],[/トマト.*ジュース/,"トマトジュース"],[/米粉.*麺|米粉麺/,"米粉麺"]
  ];
  for(const [r,o] of rules) if(r.test(n)) return o;
  return n||"商品";
}
function guessCategory(name){
  const n=canonical(name);
  const mem=data.categoryMemory;
  const key=norm(n);
  if(mem[key]) return mem[key];

  if(/洗剤|ティッシュ|ペーパー|シャンプー|歯磨き|スポンジ|ラップ|ゴミ袋/.test(n)) return "日用品";
  if(/ジュース|茶|コーヒー|水|牛乳/.test(n)) return "飲料";
  if(/味噌|醤油|塩|砂糖|酢|油|ソース/.test(n)) return "調味料";
  return "食費";
}
function rememberCategory(name, category){
  if(!name || !category) return;
  const mem=data.categoryMemory;
  mem[norm(canonical(name))]=category;
  data.categoryMemory=mem;
}
function isLearnedCategory(name){
  return !!data.categoryMemory[norm(canonical(name))];
}
function defaultExpiry(name,date){
  const map=[[/牛乳/,5],[/卵/,14],[/鶏むね肉|鶏もも肉/,2],[/食パン/,4],[/レタス|キャベツ|きゅうり|ブロッコリー|長ねぎ|れんこん|えのき/,5]];
  const d=new Date(date||todayISO()); let days=7;
  for(const [r,v] of map) if(r.test(name)){days=v;break}
  d.setDate(d.getDate()+days); return d.toISOString().slice(0,10);
}
function categoryOptions(selected="食費"){return CATEGORIES.map(c=>`<option ${c===selected?"selected":""}>${c}</option>`).join("")}
function buildFilter(container, current, setter){
  const el=$(container);
  el.innerHTML=["すべて",...CATEGORIES].map(c=>`<button class="filter-btn ${c===current?"active-filter":""}" data-cat="${c}">${c}</button>`).join("");
  el.querySelectorAll("button").forEach(b=>b.onclick=()=>setter(b.dataset.cat));
}
function go(id){
  screens.forEach(s=>s.classList.toggle("active",s.id===id));
  navButtons.forEach(b=>b.classList.toggle("active",b.dataset.go===id));
  if(id==="homeScreen")renderHome();
  if(id==="budgetScreen")renderBudget();
  if(id==="pantryScreen")renderPantry();
  if(id==="shoppingScreen")renderShopping();
  scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>go(el.dataset.go));


function daysUntil(dateStr){
  if(!dateStr) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const target=new Date(dateStr+"T00:00:00");
  return Math.round((target-today)/86400000);
}
function expiryInfo(dateStr){
  const d=daysUntil(dateStr);
  if(d===null) return {days:null,label:"期限未設定",cls:"expiry-normal"};
  if(d<0) return {days:d,label:`${Math.abs(d)}日超過`,cls:"expiry-expired"};
  if(d===0) return {days:d,label:"今日まで",cls:"expiry-today"};
  if(d===1) return {days:d,label:"明日まで",cls:"expiry-tomorrow"};
  if(d<=3) return {days:d,label:`あと${d}日`,cls:"expiry-soon"};
  return {days:d,label:`あと${d}日`,cls:"expiry-normal"};
}
function selectedMonthPurchases(){
  return data.purchases.filter(p=>{
    const d=new Date(p.date+"T00:00:00");
    return d.getFullYear()===budgetViewDate.getFullYear() && d.getMonth()===budgetViewDate.getMonth();
  });
}
function monthPurchases(){
  const now=new Date();
  return data.purchases.filter(p=>{const d=new Date(p.date);return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()})
}
function monthSpend(){return monthPurchases().reduce((s,p)=>s+p.total,0)}

function renderHome(){
  $("monthSpend").textContent=yen(monthSpend());
  $("stockCount").textContent=data.pantry.filter(i=>i.qty>0).length;
  const expiryItems=data.pantry
    .filter(i=>i.qty>0 && i.expiry && daysUntil(i.expiry)!==null && daysUntil(i.expiry)<=3)
    .sort((a,b)=>daysUntil(a.expiry)-daysUntil(b.expiry));
  $("expirySoonCount").textContent=expiryItems.length;
  const alertPanel=$("expiryAlertPanel");
  if(expiryItems.length){
    alertPanel.classList.remove("hidden");
    $("expiryAlertList").innerHTML=expiryItems.slice(0,5).map(i=>{
      const info=expiryInfo(i.expiry);
      return `<div class="expiry-alert-item"><div><strong>${esc(i.name)}</strong><small>${esc(i.expiry)} ・ 在庫 ${i.qty}</small></div><span class="expiry-chip ${info.cls}">${info.label}</span></div>`;
    }).join("");
  }else{
    alertPanel.classList.add("hidden");
  }
  const recent=[...data.purchases].reverse().slice(0,4), box=$("recentList");
  if(!recent.length){box.className="list empty";box.textContent="まだ購入データがありません。";return}
  box.className="list";
  box.innerHTML=recent.map(p=>`<div class="list-item"><div><strong>${esc(p.store||"店舗未設定")}</strong><div class="meta">${p.date} ・ ${p.items.length}品</div></div><strong>${yen(p.total)}</strong></div>`).join("");
}

function renderBudget(){
  const viewPurchases=selectedMonthPurchases();
  const viewTotal=viewPurchases.reduce((s,p)=>s+p.total,0);
  $("budgetMonthSpend").textContent=yen(viewTotal);
  $("budgetMonthLabel").textContent=`${budgetViewDate.getFullYear()}年${budgetViewDate.getMonth()+1}月`;
  const totals=Object.fromEntries(CATEGORIES.map(c=>[c,0]));
  viewPurchases.forEach(p=>p.items.forEach(i=>totals[i.category||"その他"]=(totals[i.category||"その他"]||0)+i.price*i.qty));
  $("budgetCategorySummary").innerHTML=CATEGORIES.map(c=>`<div class="category-card"><span>${c}</span><strong>${yen(totals[c])}</strong></div>`).join("");
  buildFilter("budgetCategoryFilters",budgetCategory,c=>{budgetCategory=c;renderBudget()});

  const rows=[];
  [...viewPurchases].reverse().forEach(p=>{
    p.items.forEach(i=>{
      const cat=i.category||"その他";
      if(budgetCategory==="すべて"||cat===budgetCategory) rows.push({...i,date:p.date,store:p.store,purchaseId:p.id,itemIndex:p.items.indexOf(i)});
    });
  });
  const box=$("budgetList");
  if(!rows.length){box.className="list empty";box.textContent="該当する支出がありません。";return}
  box.className="list";
  box.innerHTML=rows.map(i=>{
    const purchase=data.purchases.find(p=>p.id===i.purchaseId);
    const itemIndex=i.itemIndex;
    return `<div class="list-item">
      <div>
        <strong>${esc(i.name)}${isLearnedCategory(i.name)?'<span class="learned-note">学習済み</span>':''}</strong>
        <div class="meta">${i.date} ・ ${esc(i.store||"店舗未設定")}</div>
        ${purchase && itemIndex>=0 ? `<select class="category-edit" onchange="changeBudgetCategory('${purchase.id}',${itemIndex},this.value)">${categoryOptions(i.category||"その他")}</select>
        <button class="budget-edit-btn" onclick="openBudgetEdit('${purchase.id}',${itemIndex})">✏️ 明細を編集</button>` : ''}
      </div>
      <strong>${yen(i.price*i.qty)}</strong>
    </div>`;
  }).join("");
}


window.openBudgetEdit=(purchaseId,itemIndex)=>{
  const p=data.purchases.find(x=>x.id===purchaseId);
  const i=p?.items?.[itemIndex]; if(!p||!i)return;
  $("budgetEditPurchaseId").value=purchaseId;
  $("budgetEditItemIndex").value=itemIndex;
  $("budgetEditName").value=i.name||"";
  $("budgetEditPrice").value=i.price||0;
  $("budgetEditQty").value=i.qty||1;
  $("budgetEditCategory").innerHTML=categoryOptions(i.category||"その他");
  $("budgetEditExpiry").value=i.expiry||"";
  $("budgetEditDate").value=p.date||todayISO();
  $("budgetEditStore").value=p.store||"";
  $("budgetEditModal").classList.remove("hidden");
};
$("closeBudgetEdit").onclick=()=>$("budgetEditModal").classList.add("hidden");
$("saveBudgetEdit").onclick=()=>{
  const ps=data.purchases, id=$("budgetEditPurchaseId").value, idx=Number($("budgetEditItemIndex").value);
  const p=ps.find(x=>x.id===id), i=p?.items?.[idx]; if(!p||!i)return;
  const oldName=i.name;
  i.name=canonical($("budgetEditName").value.trim());
  i.price=Number($("budgetEditPrice").value||0);
  i.qty=Math.max(1,Number($("budgetEditQty").value||1));
  i.category=$("budgetEditCategory").value;
  i.expiry=$("budgetEditExpiry").value||"";
  p.date=$("budgetEditDate").value; p.store=$("budgetEditStore").value.trim();
  p.total=p.items.reduce((s,x)=>s+(Number(x.price)||0)*(Number(x.qty)||0),0);
  data.purchases=ps; rememberCategory(i.name,i.category);
  const pantry=data.pantry;
  pantry.forEach(x=>{if(norm(x.name)===norm(oldName)){x.name=i.name;x.category=i.category;x.expiry=i.expiry}});
  data.pantry=pantry;
  $("budgetEditModal").classList.add("hidden"); renderBudget(); renderHome();
};
$("deleteBudgetItem").onclick=()=>{
  if(!confirm("この家計簿明細を削除しますか？"))return;
  const ps=data.purchases, id=$("budgetEditPurchaseId").value, idx=Number($("budgetEditItemIndex").value);
  const p=ps.find(x=>x.id===id); if(!p)return;
  p.items.splice(idx,1);
  p.total=p.items.reduce((s,x)=>s+(Number(x.price)||0)*(Number(x.qty)||0),0);
  if(!p.items.length) ps.splice(ps.indexOf(p),1);
  data.purchases=ps;
  $("budgetEditModal").classList.add("hidden"); renderBudget(); renderHome();
};

window.changeBudgetCategory=(purchaseId,itemIndex,newCategory)=>{
  const purchases=data.purchases;
  const p=purchases.find(x=>x.id===purchaseId);
  if(!p || !p.items[itemIndex]) return;
  const item=p.items[itemIndex];
  const oldCategory=item.category;
  item.category=newCategory;
  rememberCategory(item.name,newCategory);
  data.purchases=purchases;

  // Same product in pantry follows the correction
  const pantry=data.pantry;
  pantry.forEach(x=>{
    if(norm(x.name)===norm(item.name)) x.category=newCategory;
  });
  data.pantry=pantry;

  renderBudget();
  renderHome();
};

function renderPantry(){
  buildFilter("pantryCategoryFilters",pantryCategory,c=>{pantryCategory=c;renderPantry()});
  
window.changePantryCategory=(id,newCategory)=>{
  const pantry=data.pantry;
  const item=pantry.find(x=>x.id===id);
  if(!item) return;
  item.category=newCategory;
  rememberCategory(item.name,newCategory);
  data.pantry=pantry;

  // Purchase history for the same product also follows the correction
  const purchases=data.purchases;
  purchases.forEach(p=>p.items.forEach(x=>{
    if(norm(x.name)===norm(item.name)) x.category=newCategory;
  }));
  data.purchases=purchases;

  renderPantry();
  renderHome();
};

document.querySelectorAll("[data-expiry-filter]").forEach(b=>b.onclick=()=>{
  pantryExpiry=b.dataset.expiryFilter;
  document.querySelectorAll("[data-expiry-filter]").forEach(x=>x.classList.toggle("active-filter",x.dataset.expiryFilter===pantryExpiry));
  renderPantry();
});
document.querySelectorAll("[data-stock-filter]").forEach(b=>b.classList.toggle("active-filter",b.dataset.stockFilter===pantryStock));
  let items=[...data.pantry];
  if(pantryStock==="in")items=items.filter(i=>i.qty>0);
  if(pantryStock==="out")items=items.filter(i=>i.qty===0);
  if(pantryCategory!=="すべて")items=items.filter(i=>(i.category||"その他")===pantryCategory);
  if(pantryExpiry==="soon") items=items.filter(i=>i.qty>0 && i.expiry && daysUntil(i.expiry)>=0 && daysUntil(i.expiry)<=3);
  if(pantryExpiry==="expired") items=items.filter(i=>i.qty>0 && i.expiry && daysUntil(i.expiry)<0);
  items.sort((a,b)=>{
    if(!a.expiry && !b.expiry) return a.name.localeCompare(b.name,"ja");
    if(!a.expiry) return 1;
    if(!b.expiry) return -1;
    return new Date(a.expiry)-new Date(b.expiry);
  });

  const box=$("pantryList");
  if(!items.length){box.className="group-list empty";box.textContent="該当する在庫がありません。";return}
  box.className="group-list";
  const grouped={};
  items.forEach(i=>(grouped[i.category||"その他"]??=[]).push(i));
  box.innerHTML=Object.entries(grouped).map(([cat,arr])=>`
    <div>
      <div class="group-title">${esc(cat)}（${arr.length}）</div>
      ${arr.map(i=>{
        const idx=data.pantry.findIndex(x=>x.id===i.id), out=i.qty===0;
        const exp=expiryInfo(i.expiry);
        const expClass=!out && exp.days!==null && exp.days<0 ? "stock-expired" : (!out && exp.days!==null && exp.days<=3 ? "stock-soon" : "");
        return `<div class="stock-card ${out?"out-stock":""} ${expClass}">
          <div class="stock-top"><h4>${esc(i.name)}</h4><div><span class="badge ${out?"danger-badge":"ok-badge"}">${out?"在庫なし":"在庫あり"}</span>${!out&&i.expiry?` <span class="expiry-chip ${exp.cls}">${exp.label}</span>`:""}</div></div>
          <p>数量：${i.qty}</p>
          <p>カテゴリ：
            <select class="category-edit" onchange="changePantryCategory('${i.id}',this.value)">
              ${categoryOptions(i.category||"その他")}
            </select>
            ${isLearnedCategory(i.name)?'<span class="learned-note">学習済み</span>':''}
          </p>
          <p>賞味期限：${esc(i.expiry||"未設定")}</p><p>最終購入：${esc(i.updated||"-")}</p>
          <div class="stock-actions">
            <button onclick="changeStock(${idx},-1)">−1</button>
            <button onclick="changeStock(${idx},1)">＋1</button>
            <button onclick="addPantryToShopping(${idx})">買い物リストへ</button>
          </div>
        </div>`}).join("")}
    </div>`).join("");
}

window.changePantryCategory=(id,newCategory)=>{
  const pantry=data.pantry;
  const item=pantry.find(x=>x.id===id);
  if(!item) return;
  item.category=newCategory;
  rememberCategory(item.name,newCategory);
  data.pantry=pantry;

  // Purchase history for the same product also follows the correction
  const purchases=data.purchases;
  purchases.forEach(p=>p.items.forEach(x=>{
    if(norm(x.name)===norm(item.name)) x.category=newCategory;
  }));
  data.purchases=purchases;

  renderPantry();
  renderHome();
};

document.querySelectorAll("[data-expiry-filter]").forEach(b=>b.onclick=()=>{
  pantryExpiry=b.dataset.expiryFilter;
  document.querySelectorAll("[data-expiry-filter]").forEach(x=>x.classList.toggle("active-filter",x.dataset.expiryFilter===pantryExpiry));
  renderPantry();
});
document.querySelectorAll("[data-stock-filter]").forEach(b=>b.onclick=()=>{pantryStock=b.dataset.stockFilter;renderPantry()});
window.changeStock=(idx,d)=>{const p=data.pantry;p[idx].qty=Math.max(0,Number(p[idx].qty||0)+d);data.pantry=p;renderPantry();renderHome()};
window.addPantryToShopping=(idx)=>{
  const p=data.pantry[idx]; addShopping(p.name,1,p.category||"その他","");
  alert(`${p.name}を買い物リストに追加しました`);
  renderPantry();renderHome();
};

function addShopping(name,qty,category,memo){
  const list=data.shopping, key=norm(name);
  const existing=list.find(i=>norm(i.name)===key&&!i.done);
  if(existing){existing.qty+=Number(qty||1); if(memo)existing.memo=memo}
  else list.push({id:uid(),name:canonical(name),qty:Number(qty||1),category:category||guessCategory(name),memo:memo||"",done:false});
  data.shopping=list;
}
function renderShopping(){
  buildFilter("shoppingCategoryFilters",shoppingCategory,c=>{shoppingCategory=c;renderShopping()});
  let list=[...data.shopping];
  const total=list.length, done=list.filter(i=>i.done).length;
  $("shoppingProgressText").textContent=`${done} / ${total} 完了`;
  $("shoppingProgressBar").style.width=total?`${done/total*100}%`:"0%";
  if(shoppingCategory!=="すべて")list=list.filter(i=>(i.category||"その他")===shoppingCategory);
  list.sort((a,b)=>Number(a.done)-Number(b.done));
  const box=$("shoppingList");
  if(!list.length){box.className="list empty";box.textContent="買い物リストは空です。";return}
  box.className="list";
  box.innerHTML=list.map(i=>`
    <div class="shopping-row ${i.done?"done":""}">
      <input class="shopping-check" type="checkbox" ${i.done?"checked":""} onchange="toggleShopping('${i.id}')">
      <div><div class="shopping-name">${esc(i.name)} × ${i.qty}</div><div class="shopping-meta">${esc(i.category||"その他")}${i.memo?` ・ ${esc(i.memo)}`:""}</div></div>
      <button class="delete-btn" onclick="deleteShopping('${i.id}')">×</button>
    </div>`).join("");
}
window.toggleShopping=id=>{const l=data.shopping,x=l.find(i=>i.id===id);if(x)x.done=!x.done;data.shopping=l;renderShopping();renderHome()};
window.deleteShopping=id=>{data.shopping=data.shopping.filter(i=>i.id!==id);renderShopping();renderHome()};

$("prevMonth").onclick=()=>{budgetViewDate=new Date(budgetViewDate.getFullYear(),budgetViewDate.getMonth()-1,1);renderBudget()};
$("nextMonth").onclick=()=>{budgetViewDate=new Date(budgetViewDate.getFullYear(),budgetViewDate.getMonth()+1,1);renderBudget()};
$("showExpiryPantry").onclick=()=>{pantryExpiry="soon";go("pantryScreen");document.querySelectorAll("[data-expiry-filter]").forEach(x=>x.classList.toggle("active-filter",x.dataset.expiryFilter===pantryExpiry))};
$("expiryHomeCard").onclick=()=>{pantryExpiry="soon";go("pantryScreen");document.querySelectorAll("[data-expiry-filter]").forEach(x=>x.classList.toggle("active-filter",x.dataset.expiryFilter===pantryExpiry))};

$("manualStockBtn").onclick=()=>{$("manualStockModal").classList.remove("hidden");$("manualName").value="";$("manualQty").value=1;$("manualCategory").innerHTML=categoryOptions("食費");$("manualExpiry").value=""};
$("closeStockModal").onclick=()=>$("manualStockModal").classList.add("hidden");
$("saveManualStock").onclick=()=>{
  const name=canonical($("manualName").value),qty=Math.max(0,Number($("manualQty").value||0)),category=$("manualCategory").value,expiry=$("manualExpiry").value;
  if(!name||name==="商品"){alert("商品名を入力してください");return}
  const p=data.pantry,key=norm(name),ex=p.find(i=>norm(i.name)===key);
  if(ex){ex.qty+=qty;ex.category=category;if(expiry)ex.expiry=expiry;ex.updated=todayISO()}
  else p.push({id:uid(),name,qty,category,expiry,updated:todayISO()});
  data.pantry=p;$("manualStockModal").classList.add("hidden");renderPantry();renderHome();
};

$("manualShoppingBtn").onclick=()=>{$("shoppingModal").classList.remove("hidden");$("shoppingName").value="";$("shoppingQty").value=1;$("shoppingCategory").innerHTML=categoryOptions("食費");$("shoppingMemo").value=""};
$("closeShoppingModal").onclick=()=>$("shoppingModal").classList.add("hidden");
$("saveShoppingItem").onclick=()=>{
  const name=$("shoppingName").value.trim(); if(!name){alert("商品名を入力してください");return}
  addShopping(name,$("shoppingQty").value,$("shoppingCategory").value,$("shoppingMemo").value);
  $("shoppingModal").classList.add("hidden");renderShopping();renderHome();
};


function resetReceiptState({keepPreview=false}={}){
  receiptSessionId += 1;

  if(activeOcrController){
    try{activeOcrController.abort()}catch(e){}
    activeOcrController=null;
  }

  editorItems=[];
  printedReceiptTotal=null;
  lastOcrConfidence=null;
  receiptTaxMode="included";

  if(!keepPreview){
    selectedImage=null;
    $("receiptPreview").src="";
    $("receiptPreview").classList.add("hidden");
  }

  $("ocrText").value="";
  $("ocrPanel").classList.add("hidden");
  $("ocrMeta").classList.add("hidden");
  $("ocrStatus").textContent="";
  $("ocrBtn").disabled=false;
  $("newReceiptBtn")?.classList.add("hidden");

  if($("receiptPrintedTotal")) $("receiptPrintedTotal").textContent="未検出";
  if($("totalWarning")) $("totalWarning").classList.add("hidden");

  document.querySelectorAll("[data-tax-mode]").forEach(x=>{
    x.classList.toggle("active-segment",x.dataset.taxMode==="included");
  });
}

function startNewReceipt(){
  resetReceiptState();
  $("receiptInput").value="";
  $("ocrBtn").classList.add("hidden");
  // Re-open file picker only from a direct user action
  setTimeout(()=>$("receiptInput").click(),50);
}


async function convertHeicToJpeg(file){
  const type=(file.type||"").toLowerCase();
  const name=(file.name||"").toLowerCase();
  const isHeic=type.includes("heic")||type.includes("heif")||name.endsWith(".heic")||name.endsWith(".heif");
  if(!isHeic) return file;

  if(typeof heic2any!=="function"){
    throw new Error("HEIC変換ライブラリの読み込みに失敗しました。ページを再読み込みしてください");
  }

  const converted=await heic2any({
    blob:file,
    toType:"image/jpeg",
    quality:0.9
  });

  const blob=Array.isArray(converted)?converted[0]:converted;
  if(!blob) throw new Error("HEIC画像のJPEG変換に失敗しました");

  return new File(
    [blob],
    (file.name||"receipt").replace(/\.(heic|heif)$/i,"")+".jpg",
    {type:"image/jpeg"}
  );
}

async function normalizeReceiptImage(file){
  if(!file) throw new Error("画像ファイルが選択されていません");
  file=await convertHeicToJpeg(file);
  const maxBytes=20*1024*1024;
  if(file.size>maxBytes) throw new Error("画像サイズが大きすぎます（20MB以下にしてください）");

  const canvas=document.createElement("canvas");
  const ctx=canvas.getContext("2d");
  if(!ctx) throw new Error("画像変換機能を利用できません");

  let source=null;
  let objectUrl=null;

  try{
    if("createImageBitmap" in window){
      try{
        source=await createImageBitmap(file);
      }catch(bitmapErr){
        console.warn("createImageBitmap failed", bitmapErr);
      }
    }

    if(!source){
      objectUrl=URL.createObjectURL(file);
      const img=new Image();
      img.decoding="async";
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("画像の読み込みがタイムアウトしました")),15000);
        img.onload=()=>{clearTimeout(timer);resolve();};
        img.onerror=()=>{clearTimeout(timer);reject(new Error("この画像形式をブラウザで開けませんでした"));};
        img.src=objectUrl;
      });
      source=img;
    }

    const sw=source.width || source.naturalWidth;
    const sh=source.height || source.naturalHeight;
    if(!sw || !sh) throw new Error("画像の縦横サイズを取得できませんでした");

    const maxSide=2200;
    const scale=Math.min(1,maxSide/Math.max(sw,sh));
    canvas.width=Math.max(1,Math.round(sw*scale));
    canvas.height=Math.max(1,Math.round(sh*scale));

    ctx.fillStyle="#ffffff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(source,0,0,canvas.width,canvas.height);

    const dataUrl=canvas.toDataURL("image/jpeg",0.9);
    if(!dataUrl || !dataUrl.startsWith("data:image/jpeg")){
      throw new Error("JPEGへの変換に失敗しました");
    }
    return dataUrl;
  } finally {
    if(source && typeof source.close==="function"){
      try{source.close()}catch(e){}
    }
    if(objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
$("receiptInput").onchange=async()=>{
  const input=$("receiptInput");
  const f=input.files?.[0];
  if(!f) return;

  $("ocrStatus").textContent="画像を準備しています…";
  $("ocrBtn").classList.add("hidden");
  $("ocrPanel").classList.add("hidden");

  try{
    selectedImage=await normalizeReceiptImage(f);
    $("receiptPreview").src=selectedImage;
    $("receiptPreview").classList.remove("hidden");
    $("ocrBtn").classList.remove("hidden");
    const preparedType=selectedImage?.startsWith("data:image/jpeg")?"JPEG":"画像";
    $("ocrStatus").textContent=`画像の準備ができました（${preparedType}へ変換済み）`;
  }catch(e){
    console.error("image prepare error",e);
    selectedImage=null;
    $("receiptPreview").src="";
    $("receiptPreview").classList.add("hidden");
    $("ocrStatus").textContent="画像の準備に失敗しました：" + (e?.message||String(e));
  }
};
$("ocrBtn").onclick=async()=>{
  if(!selectedImage)return;

  const mySession=receiptSessionId;
  const requestId=`receipt-${Date.now()}-${mySession}`;

  if(activeOcrController){
    try{activeOcrController.abort()}catch(e){}
  }
  activeOcrController=new AbortController();

  // Never leave the previous receipt result visible while a new receipt is being read.
  $("ocrText").value="";
  $("ocrPanel").classList.add("hidden");
  $("ocrMeta").classList.add("hidden");
  printedReceiptTotal=null;
  editorItems=[];

  $("ocrBtn").disabled=true;
  $("ocrStatus").textContent="高速OCRで読み取り中…";

  try{
    const res=await fetch(`/api/ocr?request_id=${encodeURIComponent(requestId)}`,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Cache-Control":"no-store",
        "X-SnapStock-Receipt":requestId
      },
      cache:"no-store",
      signal:activeOcrController.signal,
      body:JSON.stringify({image:selectedImage,request_id:requestId})
    });
    const body=await res.json();

    // Ignore a late response from an older receipt.
    if(mySession!==receiptSessionId) return;
    if(body.request_id && body.request_id!==requestId) return;

    if(!res.ok || !body.ok) throw new Error(body.error||`OCRに失敗しました（HTTP ${res.status}）`);

    const lines=body.lines||[];
    $("ocrText").value=lines.join("\n");
    printedReceiptTotal=body.receipt_total ?? extractPrintedTotal(lines);
    lastOcrConfidence=body.average_confidence ?? null;

    $("ocrPanel").classList.remove("hidden");
    $("ocrEngineBadge").textContent=`OCR: ${body.engine||"PaddleOCR"}`;
    $("ocrConfidenceBadge").textContent=lastOcrConfidence==null
      ?"信頼度: -"
      :`平均信頼度: ${Math.round(lastOcrConfidence*100)}%`;
    $("ocrMeta").classList.remove("hidden");
    $("ocrStatus").textContent=`このレシートを読み取りました（${lines.length}行）。`;
    $("newReceiptBtn").classList.remove("hidden");
  }catch(e){
    if(e?.name==="AbortError") return;
    if(mySession!==receiptSessionId) return;
    console.error(e);
    $("ocrStatus").textContent="OCRエラー：" + (e?.message||String(e));
    $("ocrPanel").classList.remove("hidden");
  }finally{
    if(mySession===receiptSessionId){
      $("ocrBtn").disabled=false;
      activeOcrController=null;
    }
  }
};
$("sampleBtn").onclick=()=>{
  printedReceiptTotal=1712;
  lastOcrConfidence=null;
  $("ocrText").value=`スーパー○○
${todayISO()}
卵 238
牛乳 198
鶏むね肉 580
じゃがいも 298
洗剤 398
合計 1712`;
};


function cleanMoneyText(s){
  return String(s||"")
    .replace(/[¥￥,，\s]/g,"")
    .replace(/[OoＯ]/g,"0")
    .replace(/[Ilｌ]/g,"1");
}
function toAsciiDigits(s){
  return String(s||"").replace(/[０-９]/g,c=>String("０１２３４５６７８９".indexOf(c)));
}
function extractPrintedTotal(lines){
  const candidates=[];
  for(let idx=0; idx<lines.length; idx++){
    const raw=String(lines[idx]||"").trim();
    const line=raw.replace(/\s+/g," ");

    // Explicitly reject counts and non-final totals.
    if(/お買上点数|お買い上げ点数|商品点数|点数|レジ点数|件数/.test(line)) continue;
    if(/小計|税合計|税額|外税|内税|対象額|課税対象|免税/.test(line)) continue;

    let priority=0;
    if(/(?:^|\s)総合計(?:\s|$)|総額|お支払(?:い)?額|ご請求額|支払合計/.test(line)) priority=5;
    else if(/(?:^|\s)合計(?:\s|$)|合計金額/.test(line)) priority=4;
    else if(/税込合計|税込金額/.test(line)) priority=4;
    else if(/お買上金額|お買い上げ金額/.test(line)) priority=3;
    else continue;

    const nums=[...line.matchAll(/[¥￥]?\s*([0-9０-９][0-9０-９,，]{1,8})/g)]
      .map(m=>Number(cleanMoneyText(toAsciiDigits(m[1]))))
      .filter(n=>Number.isFinite(n) && n>=50 && n<=500000);

    for(const value of nums){
      candidates.push({value,priority,idx,line});
    }
  }

  if(!candidates.length) return null;

  // Prefer explicit final-total labels, then lower lines on receipt, then larger plausible amount.
  candidates.sort((a,b)=>
    b.priority-a.priority ||
    b.idx-a.idx ||
    b.value-a.value
  );

  return candidates[0].value;
}
function validateReceiptTotal(){
  const itemTotal=editorItems.reduce((s,i)=>s+calcPaidPrice(i)*(Number(i.qty)||0),0);
  const printed=printedReceiptTotal;
  $("receiptPrintedTotal").textContent=printed==null?"未検出":yen(printed);
  const warn=$("totalWarning");
  if(printed==null){
    warn.className="total-warning";
    warn.textContent="レシートの印字合計を検出できませんでした。商品の読み取り結果を確認してください。";
    warn.classList.remove("hidden");
    return;
  }
  const diff=printed-itemTotal;
  if(diff===0){
    warn.className="total-warning ok";
    warn.textContent="✓ 商品合計とレシート印字合計が一致しています。";
  }else{
    warn.className="total-warning";
    warn.textContent=`⚠ 合計が${yen(Math.abs(diff))}ずれています。${diff>0?"読み取り漏れ、値引き行、または商品と金額の組み合わせ違いがある可能性があります。":"価格や数量の誤読がある可能性があります。"}`;
  }
  warn.classList.remove("hidden");
}


function guessTaxRate(name){
  const n=String(name||"");
  // Most food/beverage purchased for take-home is reduced rate.
  if(/酒|ビール|ワイン|焼酎|日本酒|洗剤|ティッシュ|ペーパー|シャンプー|歯磨|スポンジ|ラップ|ゴミ袋|電池|文具/.test(n)) return 10;
  return 8;
}
function calcPaidPrice(item){
  const base=Math.max(0,Number(item.price)||0);
  const discount=Math.max(0,Number(item.discount)||0);
  const discounted=Math.max(0,base-discount);
  if(receiptTaxMode==="excluded"){
    return Math.round(discounted*(1+(Number(item.taxRate)||8)/100));
  }
  return discounted;
}
function itemNeedsReview(item){
  if(!item.name || !item.price) return true;
  if(item.confidence!=null && item.confidence<0.82) return true;
  if(item.pairConfidence!=null && item.pairConfidence<0.72) return true;
  if(/[?？�]/.test(item.name)) return true;
  return false;
}
function detectDiscount(line){
  const m=String(line||"").match(/(?:値引|割引|クーポン|奉仕)[^\d\-−]*[-−]?\s*([0-9０-９][0-9０-９,，]*)/);
  if(!m) return null;
  return Number(cleanMoneyText(toAsciiDigits(m[1])))||null;
}

function parseReceipt(text){
  const items=[];
  const lines=text.split(/\n/).map(s=>s.trim()).filter(Boolean);
  let lastProduct=null;

  for(const originalLine of lines){
    const line=originalLine.replace(/\s+/g," ").trim();

    // A separate discount row belongs to the preceding product.
    if(/値引|割引|クーポン|奉仕/.test(line)){
      const d=detectDiscount(line);
      if(lastProduct && d){
        lastProduct.discount=(lastProduct.discount||0)+d;
        lastProduct.discountSource=originalLine;
      }
      continue;
    }

    if(/合計|小計|税|現金|お預|お釣|クレジット|お買上点数|お買い上げ点数|カード|ポイント|領収|レシート/.test(line)) continue;

    const matches=[...line.matchAll(/[¥￥]?\s*([0-9０-９][0-9０-９,，]{1,7})\s*円?/g)];
    if(!matches.length) continue;

    let chosen=null;
    for(let k=matches.length-1;k>=0;k--){
      const value=Number(cleanMoneyText(toAsciiDigits(matches[k][1])));
      if(Number.isFinite(value)&&value>0&&value<=200000){
        chosen={match:matches[k],value}; break;
      }
    }
    if(!chosen) continue;

    let rawName=line.slice(0,chosen.match.index).trim()
      .replace(/^[*＊・\-\s]+/,"")
      .replace(/^\d{5,14}\s*[*＊]?\s*/,"")
      .replace(/\s+[x×X]\s*\d+\s*$/,"")
      .replace(/\s+\d+\s*(個|本|袋|点|パック|P|枚)\s*$/,"")
      .trim();
    if(!rawName || /^[0-9０-９\-\s]+$/.test(rawName)) continue;

    const name=canonical(rawName);
    const item={
      name, price:chosen.value, qty:1, discount:0,
      taxRate:guessTaxRate(name),
      category:guessCategory(name), expiry:"",
      sourceLine:originalLine,
      confidence:lastOcrConfidence,
      pairConfidence:matches.length===1?0.92:0.76
    };
    items.push(item);
    lastProduct=item;
  }

  const seen=new Set();
  return items.filter(i=>{
    const key=`${norm(i.name)}|${i.price}|${i.sourceLine}`;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0,60);
}
$("toConfirmBtn").onclick=()=>{
  editorItems=parseReceipt($("ocrText").value);
  printedReceiptTotal=extractPrintedTotal($("ocrText").value.split(/\n/)) ?? printedReceiptTotal;
  if(!editorItems.length)editorItems=[{name:"卵",price:238,qty:1,category:"食費",expiry:""}];
  $("purchaseDate").value=todayISO();renderEditor();go("confirmScreen");
};
function renderEditor(){
  $("itemEditor").innerHTML=editorItems.map((i,idx)=>{
    const needs=itemNeedsReview(i);
    const paid=calcPaidPrice(i);
    return `<div class="review-card ${needs?"needs-review":""}" data-card="${idx}">
      <div class="review-summary">
        <div>
          <div class="review-name">${esc(i.name||"商品名未設定")}</div>
          <div class="review-sub">${esc(i.category||"その他")} ・ 税率 ${i.taxRate||8}%${i.discount?` ・ <span class="discount-line">値引 ${yen(i.discount)}</span>`:""}</div>
          ${receiptTaxMode==="excluded"?`<div class="payment-breakdown">税抜 ${yen(i.price)} → 税込支払額 ${yen(paid)}</div>`:""}
        </div>
        <div>
          <div class="review-price">${yen(paid)}</div>
          <div class="review-sub">${i.qty}個</div>
        </div>
      </div>
      <div class="review-actions">
        <span class="${needs?"review-warning":"review-ok"}">${needs?"⚠ 要確認":"✓ 読取OK"}</span>
        <button class="review-edit-btn" data-edit="${idx}">✏️ 修正</button>
        <button class="delete-line" data-del="${idx}">削除</button>
      </div>

      <div class="review-editor">
        <label>商品名<input class="item-name-input" value="${esc(i.name)}" data-i="${idx}" data-f="name"></label>
        <div class="item-grid">
          <label>${receiptTaxMode==="excluded"?"税抜価格":"税込価格"}
            <input class="price-input" type="number" min="0" value="${i.price}" data-i="${idx}" data-f="price">
          </label>
          <label>値引額
            <input type="number" min="0" value="${i.discount||0}" data-i="${idx}" data-f="discount">
          </label>
          <label>数量<input type="number" min="1" value="${i.qty}" data-i="${idx}" data-f="qty"></label>
          <label>カテゴリ<select data-i="${idx}" data-f="category">${categoryOptions(i.category)}</select></label>
          <label>消費期限<input type="date" value="${i.expiry||""}" data-i="${idx}" data-f="expiry"></label>
          <label>税率
            <select data-i="${idx}" data-f="taxRate">
              <option value="8" ${Number(i.taxRate)===8?"selected":""}>8%</option>
              <option value="10" ${Number(i.taxRate)===10?"selected":""}>10%</option>
            </select>
          </label>
        </div>
        ${i.sourceLine?`<div class="source-line">OCR原文：${esc(i.sourceLine)}</div>`:""}
        ${i.discountSource?`<div class="source-line discount-line">値引OCR：${esc(i.discountSource)}</div>`:""}
      </div>
    </div>`;
  }).join("");

  $("itemEditor").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{
    const card=document.querySelector(`[data-card="${b.dataset.edit}"]`);
    card.classList.toggle("editing");
  });
  $("itemEditor").querySelectorAll("input,select").forEach(el=>el.onchange=e=>{
    const i=Number(e.target.dataset.i),f=e.target.dataset.f;
    editorItems[i][f]=["price","qty","discount","taxRate"].includes(f)?Number(e.target.value||0):e.target.value;
    if(f==="name"){
      editorItems[i].category=guessCategory(e.target.value);
      editorItems[i].taxRate=guessTaxRate(e.target.value);
    }
    if(f==="category"&&editorItems[i].name) rememberCategory(editorItems[i].name,e.target.value);
    renderEditor();
  });
  $("itemEditor").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
    editorItems.splice(Number(b.dataset.del),1); renderEditor();
  });
  updateTotal();
}
function updateTotal(){
  $("confirmTotal").textContent=yen(editorItems.reduce((s,i)=>s+calcPaidPrice(i)*i.qty,0));
  validateReceiptTotal();
}
document.querySelectorAll("[data-tax-mode]").forEach(b=>b.onclick=()=>{
  receiptTaxMode=b.dataset.taxMode;
  document.querySelectorAll("[data-tax-mode]").forEach(x=>x.classList.toggle("active-segment",x.dataset.taxMode===receiptTaxMode));
  renderEditor();
});

$("addItemBtn").onclick=()=>{editorItems.push({name:"",price:0,qty:1,discount:0,taxRate:8,category:"食費",expiry:"",sourceLine:"",confidence:1,pairConfidence:1});renderEditor()};
$("saveBtn").onclick=()=>{
  const date=$("purchaseDate").value||todayISO();
  const items=editorItems.filter(i=>String(i.name).trim()&&i.qty>0).map(i=>({
    ...i,
    originalPrice:i.price,
    price:calcPaidPrice(i),
    name:canonical(i.name),
    category:i.category||guessCategory(i.name),
    expiry:i.expiry||defaultExpiry(i.name,date)
  }));
  items.forEach(i=>rememberCategory(i.name,i.category));
  if(!items.length){alert("商品を1件以上入力してください");return}
  const purchases=data.purchases; purchases.push({id:uid(),store:$("storeName").value.trim(),date,items,total:items.reduce((s,i)=>s+i.price*i.qty,0)});data.purchases=purchases;
  const pantry=data.pantry;
  items.forEach(i=>{const ex=pantry.find(p=>norm(p.name)===norm(i.name));if(ex){ex.qty+=i.qty;ex.updated=date;ex.category=i.category;ex.expiry=i.expiry}else pantry.push({id:uid(),name:i.name,qty:i.qty,category:i.category,expiry:i.expiry,updated:date})});
  data.pantry=pantry;
  alert("家計簿とパントリーに登録しました！");
  $("storeName").value="";
  resetReceiptState();
  $("receiptInput").value="";
  $("ocrBtn").classList.add("hidden");
  go("homeScreen");
};

$("editReceiptTotalBtn").onclick=()=>{
  $("receiptTotalInput").value=printedReceiptTotal??"";
  $("receiptTotalModal").classList.remove("hidden");
};
$("closeReceiptTotalModal").onclick=()=>$("receiptTotalModal").classList.add("hidden");
$("saveReceiptTotalBtn").onclick=()=>{
  const v=Number($("receiptTotalInput").value||0);
  if(!Number.isFinite(v) || v<0){alert("正しい金額を入力してください");return}
  printedReceiptTotal=v;
  $("receiptTotalModal").classList.add("hidden");
  updateTotal();
};

$("resetBtn").onclick=()=>{if(confirm("SnapStockの保存データをすべて削除しますか？")){["snapstock_purchases","snapstock_pantry","snapstock_shopping","snapstock_category_memory"].forEach(k=>localStorage.removeItem(k));renderHome()}};


if($("newReceiptBtn")){
  $("newReceiptBtn").onclick=startNewReceipt;
}

$("manualCategory").innerHTML=categoryOptions();
$("shoppingCategory").innerHTML=categoryOptions();
renderHome();


// ===== v15: inventory -> shopping flow helpers =====
function v15DaysUntil(dateStr){
  if(!dateStr) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const d=new Date(dateStr+"T00:00:00");
  if(Number.isNaN(d.getTime())) return null;
  return Math.ceil((d-today)/86400000);
}
function v15ShoppingItems(){
  try{return JSON.parse(localStorage.getItem("snapstock_shopping")||"[]")}catch(e){return[]}
}
function v15SaveShopping(items){
  localStorage.setItem("snapstock_shopping",JSON.stringify(items));
}
function v15AddToShopping(name,category){
  if(!name) return;
  const list=v15ShoppingItems();
  const key=String(name).trim().toLowerCase();
  const found=list.find(x=>String(x.name||"").trim().toLowerCase()===key && !x.done);
  if(found) found.qty=(Number(found.qty)||1)+1;
  else list.unshift({id:Date.now(),name:String(name).trim(),qty:1,category:category||"その他",done:false,createdAt:new Date().toISOString()});
  v15SaveShopping(list);
  if(typeof renderShopping==="function") renderShopping();
}
function v15MarkStockEmpty(name,category){
  // Try the app's known inventory storage, without breaking older data schemas.
  const keys=["snapstock_inventory","inventory"];
  for(const k of keys){
    try{
      const arr=JSON.parse(localStorage.getItem(k)||"[]");
      if(Array.isArray(arr)){
        const target=arr.find(x=>x.name===name);
        if(target){target.qty=0; target.status="empty"; localStorage.setItem(k,JSON.stringify(arr));}
      }
    }catch(e){}
  }
  v15AddToShopping(name,category);
  if(typeof renderInventory==="function") renderInventory();
}
function v15EnhanceInventoryDOM(){
  const root=document.getElementById("inventoryList")||document.querySelector(".inventory-list");
  if(!root) return;
  [...root.children].forEach(card=>{
    if(card.dataset.v15enhanced) return;
    const text=card.innerText||"";
    const nameEl=card.querySelector("strong,h3,.item-name,.stock-name");
    const name=(nameEl?.textContent||text.split("\n")[0]||"").trim();
    if(!name) return;
    const expiryEl=card.querySelector("[data-expiry],.expiry");
    const expiry=expiryEl?.dataset?.expiry||expiryEl?.getAttribute?.("data-expiry")||"";
    const days=v15DaysUntil(expiry);
    if(days!==null){
      if(days<0) card.classList.add("expiry-danger");
      else if(days<=3) card.classList.add("expiry-danger");
      else if(days<=7) card.classList.add("expiry-soon");
    }
    const row=document.createElement("div");
    row.className="stock-action-row";
    const empty=document.createElement("button");
    empty.className="stock-action-btn";
    empty.textContent="使い切った";
    empty.onclick=()=>v15MarkStockEmpty(name,"その他");
    const buy=document.createElement("button");
    buy.className="stock-action-btn buy";
    buy.textContent="＋ 買い物リスト";
    buy.onclick=()=>v15AddToShopping(name,"その他");
    row.append(empty,buy);
    card.appendChild(row);
    card.dataset.v15enhanced="1";
  });
}
const v15Observer=new MutationObserver(()=>v15EnhanceInventoryDOM());
window.addEventListener("DOMContentLoaded",()=>{
  v15EnhanceInventoryDOM();
  v15Observer.observe(document.body,{subtree:true,childList:true});
});
