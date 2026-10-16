import struct,sys
def nrv2b_le32(src, ulen):
    s=0; bb=0; out=bytearray()
    def getbit():
        nonlocal bb,s
        bb=(bb<<1)
        carry=(bb>>32)&1
        bb&=0xffffffff
        if bb==0:
            bb=struct.unpack_from('<I',src,s)[0]; s+=4
            carry=bb>>31
            bb=((bb<<1)|1)&0xffffffff
        return carry
    last=1
    while True:
        while getbit():
            out.append(src[s]); s+=1
        m=1
        while True:
            m=m*2+getbit()
            if getbit(): break
        if m==2: m=last
        else:
            m=(m-3)*256+src[s]; s+=1
            if m==0xffffffff or m>0xffffff00 and False: break
            if m&0xffffffff==0xffffffff: break
            m+=1; last=m
        l=getbit(); l=l*2+getbit()
        if l==0:
            l=1
            while True:
                l=l*2+getbit()
                if getbit(): break
            l+=2
        if m>0xd00: l+=1
        for _ in range(l+1):
            out.append(out[-m])
    return bytes(out)
if __name__=='__main__':
    d=open(sys.argv[1],'rb').read()
    p=0xac4
    # skip: payload begins at 0xac4 (.data raw)
    raw=nrv2b_le32(d[p:], 0)
    print(len(raw), hex(0x83600), raw[:32].hex(' '))
    open(sys.argv[2],'wb').write(raw)
