document.addEventListener('DOMContentLoaded', function(){
  if(window.lucide){window.lucide.createIcons();}

  var menuBtn=document.getElementById('menuBtn');
  var mobileMenu=document.getElementById('mobileMenu');
  if(menuBtn&&mobileMenu){
    menuBtn.addEventListener('click',function(){mobileMenu.classList.toggle('hidden');});
    mobileMenu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){mobileMenu.classList.add('hidden');});});
  }

  var counters=document.querySelectorAll('.kpi-value[data-target]');
  counters.forEach(function(el){
    var target=parseInt(el.getAttribute('data-target'),10)||0;
    var prefix=el.getAttribute('data-prefix')||'';
    var suffix=el.getAttribute('data-suffix')||'';
    var start=0,duration=1200,startTs=null;
    function step(ts){
      if(!startTs)startTs=ts;
      var p=Math.min((ts-startTs)/duration,1);
      var eased=1-Math.pow(1-p,3);
      var v=Math.floor(eased*target);
      el.textContent=prefix+v.toLocaleString('it-IT')+suffix;
      if(p<1)requestAnimationFrame(step);
    }
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting){requestAnimationFrame(step);io.unobserve(el);}});
    },{threshold:0.4});
    io.observe(el);
  });

  function fmt(n){return n.toLocaleString('it-IT');}
  var cyan='#22d3ee',blue='#3b82f6',indigo='#6366f1',amber='#fbbf24',rose='#fb7185',emerald='#34d399',slate500='#64748b';
  Chart.defaults.color=slate500;Chart.defaults.borderColor='rgba(255,255,255,0.05)';Chart.defaults.font.family="'Inter',system-ui,sans-serif";

  function doughnut(id,labels,data,colors,cutout){
    var c=document.getElementById(id);
    if(!c)return;
    new Chart(c,{type:'doughnut',data:{labels:labels,datasets:[{data:data,backgroundColor:colors,borderColor:'#0a0f1c',borderWidth:3,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:cutout||'65%',plugins:{legend:{position:'right',labels:{boxWidth:10,boxHeight:10,padding:12,usePointStyle:true,pointStyle:'circle',color:'#cbd5e1'}}}}}});
  }
  function bar(id,labels,data,color,horizontal){
    var c=document.getElementById(id);if(!c)return;
    new Chart(c,{type:'bar',data:{labels:labels,datasets:[{data:data,backgroundColor:color,borderRadius:6,barThickness:horizontal?18:28,maxBarThickness:36}]},options:{indexAxis:horizontal?'y':'x',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#94a3b8'}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#94a3b8',callback:function(v){return horizontal?v:fmt(v);}}}}}});
  }

  doughnut('chartLoyalty',['Bronze','Silver','Gold','Platinum'],[38,32,20,10],[rose,amber,cyan,emerald],'62%');
  bar('chartChurn',['Bronze','Silver','Gold','Platinum'],[42,28,15,7],'rgba(251,113,133,0.85)');
  doughnut('chartPay',['Credit Card','PayPal','BNPL','Bank Transfer','Crypto'],[42,24,14,12,8],[cyan,blue,amber,emerald,indigo],'60%');
  bar('chartRegion',['North America','Europe','Asia-Pacific','Latin America'],[2150000,1820000,980000,350000],'rgba(34,211,238,0.85)',true);

  var form=document.getElementById('contactForm');
  var status=document.getElementById('formStatus');
  if(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var inputs=form.querySelectorAll('input[required],textarea[required]');
      var ok=true;inputs.forEach(function(i){if(!i.value.trim()){i.style.borderColor='#fb7185';ok=false;}else{i.style.borderColor='';}});
      if(!ok)return;
      if(status){status.classList.remove('hidden');}
      form.reset();
      setTimeout(function(){if(status)status.classList.add('hidden');},5000);
    });
  }
});