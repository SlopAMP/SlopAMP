(function(){
  var c=document.getElementById('viz');if(!c)return;
  var x=c.getContext('2d'),N=28,v=new Array(N).fill(0),p=new Array(N).fill(0),t=0,s=0;
  var still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var tm=document.getElementById('time');
  function f(){
    var w=c.width,h=c.height,bw=w/N;t+=0.05;x.clearRect(0,0,w,h);
    for(var i=0;i<N;i++){
      var tgt=(0.35+0.3*Math.sin(t*1.3+i*0.5)+0.25*Math.sin(t*3.1+i*1.7)+Math.random()*0.2)*(1-i/N*0.45);
      v[i]+= (Math.max(0.05,Math.min(1,tgt))-v[i])*0.35;
      p[i]=Math.max(p[i]-0.01,v[i]);
      var bh=v[i]*h;
      for(var y=h;y>h-bh;y-=4){var r=(h-y)/h;x.fillStyle=r>.8?'#e9ff3a':r>.55?'#b6ff3a':'#39ff6a';x.fillRect(i*bw+1,y-3,bw-2,3);}
      x.fillStyle='#d8ffe0';x.fillRect(i*bw+1,h-p[i]*h-2,bw-2,2);
    }
    if(!still)requestAnimationFrame(f);
  }
  f();
  if(tm&&!still)setInterval(function(){s++;tm.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},1000);
})();
(function(){var lb=document.getElementById('lb');if(!lb)return;var im=lb.querySelector('img'),cap=lb.querySelector('p');
document.querySelectorAll('.gallery img').forEach(function(i){i.addEventListener('click',function(){im.src=i.src;cap.textContent=i.closest('figure').querySelector('figcaption').textContent;lb.hidden=false;});});
lb.addEventListener('click',function(){lb.hidden=true;});document.addEventListener('keydown',function(e){if(e.key==='Escape')lb.hidden=true;});})();
(function(){
  function initCarousel(g){
    var f=[].slice.call(g.querySelectorAll('.shot')),n=f.length,i=0,d=g.querySelector('.dots'),t;
    if(!n||!d)return;
    f.forEach(function(_,k){var b=document.createElement('b');b.onclick=function(){go(k);};d.appendChild(b);});
    function go(k){i=(k+n)%n;f.forEach(function(e,k2){var o=((k2-i)%n+n)%n;if(o>n/2)o-=n;e.className='shot'+(o===0?' c0':o===1?' c1':o===-1?' cm1':o===2?' c2':o===-2?' cm2':'');});[].forEach.call(d.children,function(b,k2){b.className=k2===i?'on':'';});reset();}
    function reset(){clearInterval(t);t=setInterval(function(){go(i+1);},3500);}
    g.querySelector('.prev').onclick=function(){go(i-1);};g.querySelector('.next').onclick=function(){go(i+1);};
    g.addEventListener('mouseenter',function(){clearInterval(t);});g.addEventListener('mouseleave',reset);
    var x0=null;g.addEventListener('touchstart',function(e){x0=e.touches[0].clientX;});g.addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)go(i+(dx<0?1:-1));x0=null;});
    go(0);
  }
  [].forEach.call(document.querySelectorAll('.carousel'),initCarousel);
})();
