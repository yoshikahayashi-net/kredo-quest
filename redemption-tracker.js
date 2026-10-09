/* Server-backed reward redemption tracking for Kredo Quest.
   The SQL RPC is the authority for price, available points, deduction, and audit record. */
(function(){
  'use strict';
  let busy = false;
  const REWARDS = {
    cafe1: {cost:100, name:'ホウゲツカフェから好きな1品券'},
    lottery1: {cost:300, name:'抽せん確率アップ権 1個'},
    lottery2: {cost:500, name:'抽せん確率アップ権 2個'}
  };
  // ホウゲツカフェ2人分は、運用が複雑になるため一時的に非表示にします。
  function hideCafeTwoReward(){
    const pausedTitle = /ホウゲツカフェ\s*2人分/;
    let hiddenAny = false;

    function hideMatchingCard(start){
      let node = start;
      for(let depth = 0; node && node !== document.body && depth < 12; depth++, node = node.parentElement){
        const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ');
        const buttons = node.querySelectorAll ? node.querySelectorAll('button, .exchange-btn') : [];
        if(pausedTitle.test(text) && buttons.length >= 1 && buttons.length <= 2){
          node.style.setProperty('display', 'none', 'important');
          node.hidden = true;
          node.setAttribute('aria-hidden', 'true');
          hiddenAny = true;
          return true;
        }
      }
      return false;
    }

    document.querySelectorAll('[onclick*="cafe2"], [data-reward-id="cafe2"], [data-reward="cafe2"], [data-item-id="cafe2"]').forEach(hideMatchingCard);
    if(!hiddenAny){
      document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,strong,b,div').forEach(function(el){
        if(el.children.length <= 2 && pausedTitle.test(String(el.textContent || '').replace(/\s+/g, ' '))){
          hideMatchingCard(el);
        }
      });
    }
    return hiddenAny;
  }

  function watchForPausedCafeTwoReward(){
    if(hideCafeTwoReward() || !document.body || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(function(){
      if(hideCafeTwoReward()) observer.disconnect();
    });
    observer.observe(document.body, {childList:true, subtree:true});
  }

  function currentAuthUser(){
    try { return (typeof currentUser !== 'undefined') ? currentUser : null; }
    catch(e){ return null; }
  }
  function supabase(){
    try { return (typeof supabaseClient !== 'undefined') ? supabaseClient : null; }
    catch(e){ return null; }
  }
  function showMessage(title, message, action){
    const modal = document.getElementById('exchangeModal');
    const titleEl = document.getElementById('exchangeModalTitle');
    const messageEl = document.getElementById('exchangeModalMessage');
    const ok = document.getElementById('exchangeModalOk');
    const cancel = document.getElementById('exchangeModalCancel');
    if(!modal || !titleEl || !messageEl || !ok || !cancel){
      window.alert(title + '\n\n' + String(message).replace(/<[^>]*>/g,''));
      if(typeof action === 'function') action();
      return;
    }
    titleEl.textContent = title;
    messageEl.innerHTML = message;
    ok.style.display = action ? 'inline-flex' : 'none';
    ok.textContent = action ? 'ログイン画面へ' : '閉じる';
    ok.onclick = function(){
      modal.hidden = true;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden','true');
      if(typeof action === 'function') action();
    };
    cancel.textContent = action ? 'あとで' : '閉じる';
    cancel.onclick = function(){
      modal.hidden = true;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden','true');
    };
    document.body.appendChild(modal);
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden','false');
  }
  function loginRequired(){
    showMessage(
      'アカウントへのログインが必要です',
      '景品交換を管理側で正しく記録するため、登録済みアカウントでログインしてから交換してください。',
      function(){ if(typeof openAccount === 'function') openAccount(); }
    );
  }
  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function refreshLocalState(userId, result){
    const stateKey = 'kredoState:' + userId + ':totalPoints';
    const total = Number(result.total_points);
    if(Number.isFinite(total) && total >= 0){
      localStorage.setItem(stateKey, String(total));
      try{
        if(typeof state !== 'undefined' && typeof stateOwnerKey !== 'undefined' && stateOwnerKey === 'kredoState:' + userId + ':'){
          state.totalPoints = total;
          if(typeof saveState === 'function') saveState();
        }
      }catch(e){}
      try{
        const ranking = JSON.parse(localStorage.getItem('kredoDemoRanking') || '[]');
        if(Array.isArray(ranking)){
          const row = ranking.find(function(x){ return x && x.id === userId; });
          if(row) row.points = total;
          localStorage.setItem('kredoDemoRanking', JSON.stringify(ranking));
        }
      }catch(e){}
    }
    const customKey = 'kredoCustomization:' + userId;
    let custom = {};
    try {
      if(typeof customization !== 'undefined' && typeof customizationLoadedFor !== 'undefined' && customizationLoadedFor === customKey){
        custom = JSON.parse(JSON.stringify(customization));
      }else{
        custom = JSON.parse(localStorage.getItem(customKey) || '{}') || {};
      }
    } catch(e){
      try { custom = JSON.parse(localStorage.getItem(customKey) || '{}') || {}; } catch(ignore){}
    }
    custom.spentPoints = Number(result.spent_points) || 0;
    localStorage.setItem(customKey, JSON.stringify(custom));
    try{
      if(typeof customization !== 'undefined' && typeof customizationLoadedFor !== 'undefined' && customizationLoadedFor === customKey){
        customization.spentPoints = custom.spentPoints;
      }
    }catch(e){}
  }
  async function completeRedemption(id, displayedCost, displayedName){
    const user = currentAuthUser();
    const db = supabase();
    if(!user || user.demo || !db){
      loginRequired();
      return;
    }
    if(busy) return;
    const reward = REWARDS[id];
    if(!reward || Number(displayedCost) !== reward.cost){
      showMessage('交換できませんでした','景品情報を確認できませんでした。画面を再読み込みしてください。');
      return;
    }
    busy = true;
    const buttons = document.querySelectorAll('.exchange-btn');
    buttons.forEach(function(button){button.disabled = true;});
    try{
      const {data,error} = await db.rpc('kredo_redeem_reward',{p_reward_id:id});
      if(error){
        const message = String(error.message || '');
        if(message.includes('insufficient_points')){
          showMessage('ポイントが足りません','サーバー上の利用可能ポイントが不足しています。残高を更新してから、もう一度確認してください。');
        }else if(message.includes('login_required') || message.includes('JWT')){
          showMessage('ログインの有効期限が切れました','もう一度ログインしてから交換してください。',function(){if(typeof openAccount === 'function') openAccount();});
        }else if(message.includes('reward_not_available')){
          showMessage('交換できませんでした','この景品は現在交換できません。画面を再読み込みしてください。');
        }else{
          console.error('Reward redemption failed:',error);
          const diagnostics = [
            'code: ' + (error.code || 'unknown'),
            'message: ' + (error.message || 'no message'),
            error.details ? 'details: ' + error.details : '',
            error.hint ? 'hint: ' + error.hint : ''
          ].filter(Boolean).join('\n');
          showMessage(
            '交換処理でエラーが発生しました',
            'ポイントは消費されていません。<br>原因確認用のエラー情報：<br><code style="white-space:pre-wrap;word-break:break-word;">' + escapeHtml(diagnostics) + '</code>'
          );
        }
        return;
      }
      const result = Array.isArray(data) ? data[0] : data;
      if(!result || result.redemption_id == null){
        showMessage('交換を確認できませんでした','サーバーから交換記録を確認できませんでした。ポイント残高を確認してください。');
        return;
      }
      refreshLocalState(user.id, result);
      try{
        if(typeof addPointHistory === 'function'){
          addPointHistory('spend',result.reward_name || reward.name,Number(result.points_spent)||reward.cost,'特典交換','server-redemption-'+result.redemption_id);
        }
      }catch(e){}
      try{ if(typeof renderPointExchange === 'function') renderPointExchange(); }catch(e){}
      try{ if(typeof renderPointHistory === 'function') renderPointHistory(); }catch(e){}
      try{ if(typeof window.__syncPointBalanceSafe === 'function') window.__syncPointBalanceSafe(); }catch(e){}
      showMessage(
        '交換しました',
        '「' + escapeHtml(result.reward_name || reward.name) + '」と交換しました。<br><strong>' + (Number(result.points_spent)||reward.cost) + ' pt</strong>を使用しました。<br>交換後の残高：<strong>' + (Number(result.balance_after)||0) + ' pt</strong>'
      );
    }catch(error){
      console.error('Reward redemption unexpected error:',error);
      showMessage('交換に失敗しました','交換を完了できませんでした。ポイントは消費されていません。ログイン状態と通信状況を確認して、再度お試しください。');
    }finally{
      busy = false;
      buttons.forEach(function(button){button.disabled = false;});
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', watchForPausedCafeTwoReward, {once:true});
  } else {
    watchForPausedCafeTwoReward();
  }

  window.__safeCompletePointExchange = completeRedemption;
  window.__pointExchangeClick = function(id,cost,name){
    const user = currentAuthUser();
    const db = supabase();
    if(!user || user.demo || !db){
      loginRequired();
      return;
    }
    const reward = REWARDS[id];
    if(!reward || Number(cost) !== reward.cost){
      showMessage('交換できませんでした','景品情報が一致しません。画面を再読み込みしてください。');
      return;
    }
    // 実際の残高確認は、同時交換も考慮してサーバー側RPCで行います。
    showMessage('交換しますか？','「' + escapeHtml(reward.name) + '」と交換しますか？<br><strong>' + reward.cost + ' pt</strong>を使用します。',function(){});
    const modal = document.getElementById('exchangeModal');
    const ok = document.getElementById('exchangeModalOk');
    const cancel = document.getElementById('exchangeModalCancel');
    if(ok){
      ok.style.display = 'inline-flex';
      ok.textContent = 'はい、交換する';
      ok.onclick = function(){
        modal.hidden = true; modal.style.display = 'none'; modal.setAttribute('aria-hidden','true');
        completeRedemption(id,cost,name);
      };
    }
    if(cancel){
      cancel.textContent = 'いいえ';
      cancel.onclick = function(){ modal.hidden = true; modal.style.display = 'none'; modal.setAttribute('aria-hidden','true'); };
    }
  };
})();