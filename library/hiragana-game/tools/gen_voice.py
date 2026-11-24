# ひらがなの にわ の声を作って index.html に埋め込む（パソコンで実行）
# 使い方:  pip install edge-tts   →   python3 gen_voice.py [ボイス名]
# ボイスは karada-game と同じものに合わせる（わからなければ ja-JP-NanamiNeural）。ffmpeg があれば無音をカットする。
import asyncio,base64,json,re,sys,subprocess,os,shutil
import edge_tts
VOICE=sys.argv[1] if len(sys.argv)>1 else 'ja-JP-NanamiNeural'
RATE='-15%'
P=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','index.html')
html=open(P,encoding='utf8').read()
rows=re.search(r'const ROWS=\[(.*?)\];\s*const ALL',html,re.S).group(1)
units={a or b for a,b in re.findall(r"'([ぁ-ゟ]+)'|\"([ぁ-ゟ]+)\"",rows)}
words=json.loads(re.search(r'const WORDS=(\[.*?\]);\s*\n',html,re.S).group(1))
texts=sorted(units|{w[0] for w in words})
print(len(texts),'items /',VOICE)
out={}
async def one(t):
    b=b''
    async for ch in edge_tts.Communicate(t,VOICE,rate=RATE).stream():
        if ch['type']=='audio': b+=ch['data']
    if shutil.which('ffmpeg'):
        r=subprocess.run(['ffmpeg','-loglevel','error','-i','pipe:0','-af','silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse','-ar','24000','-ac','1','-b:a','40k','-f','mp3','pipe:1'],input=b,capture_output=True).stdout
        b=r or b
    out[t]='data:audio/mpeg;base64,'+base64.b64encode(b).decode()
async def main():
    sem=asyncio.Semaphore(4)
    async def g(t):
        async with sem: await one(t)
    await asyncio.gather(*[g(t) for t in texts])
asyncio.run(main())
new='const VOICE='+json.dumps(out,ensure_ascii=False)+';'
html,n=re.subn(r'const VOICE=\{.*?\};(?=\s*\n)',lambda m:new,html,count=1,flags=re.S)
assert n==1
open(P,'w',encoding='utf8').write(html)
print('embedded',len(out),'clips,',os.path.getsize(P)//1024,'KB')
