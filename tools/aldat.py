import struct
def fcc(b): return b.decode('latin1')
def parse(raw):
    assert raw[:4]==b'ALL.'
    n=struct.unpack('>I',raw[4:8])[0]; p=8; objs=[]
    for _ in range(n):
        props={}
        while raw[p:p+4]==b'prop':
            t=fcc(raw[p+4:p+8]); sz=struct.unpack('>I',raw[p+8:p+12])[0]
            props[t]=raw[p+12:p+12+sz]; p+=12+sz
        typ=fcc(raw[p:p+4]); csz,usz=struct.unpack('>ii',raw[p+4:p+12]); p+=12
        objs.append(dict(type=typ,props=props,off=p,size=csz,usize=usz,data=raw[p:p+csz]))
        p+=csz
    return objs,p
if __name__=='__main__':
    import sys
    raw=open(sys.argv[1],'rb').read()
    objs,end=parse(raw)
    print(len(objs),'objects; parsed to',end,'of',len(raw))
    for i,o in enumerate(objs):
        print(i,o['type'],o['props'].get('NAME',b'?').rstrip(b'\0').decode('latin1'),o['size'],{k:v[:20] for k,v in o['props'].items() if k!='NAME'} if len(sys.argv)>2 else '')
