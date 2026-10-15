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
  function ensurePwaMetadata(){
    if(!document.head) return;
    function upsertLink(selector, rel, href, type, sizes){
      let link = document.head.querySelector(selector);
      if(!link){ link = document.createElement('link'); link.rel = rel; document.head.appendChild(link); }
      link.href = href;
      if(type) link.type = type;
      if(sizes) link.sizes = sizes;
    }
    upsertLink('link[rel="manifest"]','manifest','./manifest.webmanifest');
    upsertLink('link[rel="icon"],link[rel="shortcut icon"]','icon','./icons/kredo-quest-icon.svg','image/svg+xml','any');
    upsertLink('link[rel="apple-touch-icon"]','apple-touch-icon','./icons/kredo-quest-192.png','image/png','192x192');

    function upsertMeta(name, content){
      let meta = document.head.querySelector('meta[name="' + name + '"]');
      if(!meta){ meta = document.createElement('meta'); meta.name = name; document.head.appendChild(meta); }
      meta.content = content;
    }
    upsertMeta('theme-color','#082d69');
    upsertMeta('apple-mobile-web-app-capable','yes');
    upsertMeta('apple-mobile-web-app-title','クレドクエスト');
  }

  function ensureExchangeModal(){
    if(!document.body) return null;
    let modal = document.getElementById('exchangeModal');
    const markup = '<div class="kredo-exchange-dialog" role="dialog" aria-modal="true" aria-labelledby="exchangeModalTitle" tabindex="-1">' +
      '<h2 id="exchangeModalTitle"></h2><div id="exchangeModalMessage"></div>' +
      '<div class="kredo-exchange-actions"><button type="button" id="exchangeModalCancel"></button><button type="button" id="exchangeModalOk"></button></div></div>';

    if(!modal){
      modal = document.createElement('div');
      modal.id = 'exchangeModal';
      modal.hidden = true;
      modal.setAttribute('aria-hidden','true');
      modal.innerHTML = markup;
    }
    let titleEl = modal.querySelector('#exchangeModalTitle');
    let messageEl = modal.querySelector('#exchangeModalMessage');
    let ok = modal.querySelector('#exchangeModalOk');
    let cancel = modal.querySelector('#exchangeModalCancel');
    if(!titleEl || !messageEl || !ok || !cancel){
      modal.innerHTML = markup;
      titleEl = modal.querySelector('#exchangeModalTitle');
      messageEl = modal.querySelector('#exchangeModalMessage');
      ok = modal.querySelector('#exchangeModalOk');
      cancel = modal.querySelector('#exchangeModalCancel');
    }
    if(!modal.querySelector('[role="dialog"]')){
      const dialog = modal.firstElementChild;
      if(dialog) {
        dialog.setAttribute('role','dialog');
        dialog.setAttribute('aria-modal','true');
        dialog.setAttribute('aria-labelledby','exchangeModalTitle');
        dialog.setAttribute('tabindex','-1');
      }
    }

    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '2147483000';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '18px';
    modal.style.boxSizing = 'border-box';
    modal.style.background = 'rgba(5, 20, 49, .72)';
    modal.style.backdropFilter = 'blur(5px)';
    modal.style.overflowY = 'auto';
    modal.style.display = modal.hidden ? 'none' : 'flex';
    modal.style.webkitOverflowScrolling = 'touch';

    const dialog = modal.querySelector('[role="dialog"]') || modal.firstElementChild;
    if(dialog){
      dialog.style.width = 'min(420px, 100%)';
      dialog.style.maxWidth = '100%';
      dialog.style.maxHeight = 'min(84vh, 720px)';
      dialog.style.overflowY = 'auto';
      dialog.style.boxSizing = 'border-box';
      dialog.style.margin = 'auto';
      dialog.style.padding = '24px';
      dialog.style.borderRadius = '22px';
      dialog.style.background = '#ffffff';
      dialog.style.color = '#173244';
      dialog.style.boxShadow = '0 24px 72px rgba(0, 15, 43, .32)';
      dialog.style.fontFamily = 'inherit';
    }
    titleEl.style.margin = '0 0 12px';
    titleEl.style.fontSize = '1.22rem';
    titleEl.style.lineHeight = '1.45';
    titleEl.style.fontWeight = '800';
    messageEl.style.lineHeight = '1.75';
    messageEl.style.overflowWrap = 'anywhere';
    messageEl.style.marginBottom = '22px';

    const actions = ok.parentElement;
    if(actions){
      actions.style.display = 'flex';
      actions.style.justifyContent = 'flex-end';
      actions.style.flexWrap = 'wrap';
      actions.style.gap = '10px';
      actions.style.marginTop = '8px';
    }
    [ok,cancel].forEach(function(button){
      button.type = 'button';
      button.style.minHeight = '44px';
      button.style.padding = '10px 17px';
      button.style.border = '0';
      button.style.borderRadius = '12px';
      button.style.font = 'inherit';
      button.style.fontWeight = '700';
      button.style.cursor = 'pointer';
      button.style.flex = '0 1 auto';
    });
    ok.style.background = '#087bb8';
    ok.style.color = '#ffffff';
    cancel.style.background = '#edf3f7';
    cancel.style.color = '#173244';

    if(modal.parentElement !== document.body) document.body.appendChild(modal);
    if(modal.dataset.kredoDialogBound !== 'true'){
      modal.addEventListener('click',function(event){
        if(event.target === modal){
          modal.hidden = true;
          modal.style.setProperty('display','none','important');
          modal.setAttribute('aria-hidden','true');
          if(modal.__kredoPreviousFocus && typeof modal.__kredoPreviousFocus.focus === 'function') modal.__kredoPreviousFocus.focus();
        }
      });
      modal.addEventListener('keydown',function(event){
        if(event.key === 'Escape' && !modal.hidden){
          modal.hidden = true;
          modal.style.setProperty('display','none','important');
          modal.setAttribute('aria-hidden','true');
          if(modal.__kredoPreviousFocus && typeof modal.__kredoPreviousFocus.focus === 'function') modal.__kredoPreviousFocus.focus();
        }
      });
      modal.dataset.kredoDialogBound = 'true';
    }
    return modal;
  }

  function showMessage(title, message, action){
    const modal = ensureExchangeModal();
    if(!modal){
      window.alert(title + '\n\n' + String(message).replace(/<[^>]*>/g,''));
      return;
    }
    const titleEl = modal.querySelector('#exchangeModalTitle');
    const messageEl = modal.querySelector('#exchangeModalMessage');
    const ok = modal.querySelector('#exchangeModalOk');
    const cancel = modal.querySelector('#exchangeModalCancel');
    modal.__kredoPreviousFocus = document.activeElement;
    titleEl.textContent = title;
    messageEl.innerHTML = message;
    ok.style.display = action ? 'inline-flex' : 'none';
    ok.textContent = action ? 'ログイン画面へ' : '閉じる';
    ok.onclick = function(){
      modal.hidden = true;
      modal.style.setProperty('display','none','important');
      modal.setAttribute('aria-hidden','true');
      if(typeof action === 'function') action();
    };
    cancel.textContent = action ? 'あとで' : '閉じる';
    cancel.onclick = function(){
      modal.hidden = true;
      modal.style.setProperty('display','none','important');
      modal.setAttribute('aria-hidden','true');
      if(modal.__kredoPreviousFocus && typeof modal.__kredoPreviousFocus.focus === 'function') modal.__kredoPreviousFocus.focus();
    };
    modal.classList.remove('hidden');
    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.style.setProperty('display','flex','important');
    modal.style.setProperty('z-index','2147483000','important');
    modal.setAttribute('aria-hidden','false');
    const dialog = modal.querySelector('[role="dialog"]');
    if(dialog) dialog.focus({preventScroll:true});
    if(action) ok.focus({preventScroll:true});
    else cancel.focus({preventScroll:true});
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
  function cachedAvailablePoints(userId){
    try{
      const rawTotal = localStorage.getItem('kredoState:' + userId + ':totalPoints');
      if(rawTotal == null || !Number.isFinite(Number(rawTotal))) return null;
      let spent = 0;
      try{
        const custom = JSON.parse(localStorage.getItem('kredoCustomization:' + userId) || '{}');
        spent = Number(custom && custom.spentPoints) || 0;
      }catch(e){}
      return Math.max(0,Number(rawTotal) - spent);
    }catch(e){ return null; }
  }

  async function readCurrentAvailablePoints(db, userId){
    try{
      const profileResult = await db.from('profiles').select('total_points').eq('id',userId).maybeSingle();
      if(profileResult.error || !profileResult.data) throw new Error('profile balance unavailable');
      const customResult = await db.from('player_customizations').select('spent_points').eq('user_id',userId).maybeSingle();
      if(customResult.error) throw customResult.error;
      const total = Number(profileResult.data.total_points) || 0;
      const spent = Number(customResult.data && customResult.data.spent_points) || 0;
      return Math.max(0,total-spent);
    }catch(e){
      return cachedAvailablePoints(userId);
    }
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
          const balance = await readCurrentAvailablePoints(db,user.id);
          const currentText = balance == null
            ? '現在のポイント残高を取得できませんでした。'
            : '現在 <strong>' + balance.toLocaleString('ja-JP') + ' pt</strong> です。';
          showMessage('ポイントが足りません',currentText + '<br>交換には <strong>' + reward.cost.toLocaleString('ja-JP') + ' pt</strong> 必要です。<br>ポイントを貯めてから、もう一度お試しください。');
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
      showMessage('交換結果を確認できませんでした','通信状況により交換結果を確認できませんでした。二重交換を防ぐため、画面を再読み込みし、ポイント残高と交換履歴を確認してください。');
    }finally{
      busy = false;
      buttons.forEach(function(button){button.disabled = false;});
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      ensurePwaMetadata();
      watchForPausedCafeTwoReward();
    }, {once:true});
  } else {
    ensurePwaMetadata();
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
        modal.hidden = true; modal.style.setProperty('display','none','important'); modal.setAttribute('aria-hidden','true');
        completeRedemption(id,cost,name);
      };
    }
    if(cancel){
      cancel.textContent = 'いいえ';
      cancel.onclick = function(){ modal.hidden = true; modal.style.setProperty('display','none','important'); modal.setAttribute('aria-hidden','true'); };
    }
  };
})();