import struct
N,F,TH=4096,18,2
def unpack(data, password):
    """Allegro 3.x packfile (F_PACK_MAGIC, old crypt: only flag bytes are XOR'd with the cycling password)."""
    s=4  # skip magic
    ring=bytearray(N); r=N-F; out=bytearray(); pw=password; pp=0
    while s<len(data):
        c=data[s]; s+=1
        if pw:
            c^=pw[pp]; pp=(pp+1)%len(pw)
        flags=c
        for _ in range(8):
            if s>=len(data): break
            lit=flags&1; flags>>=1
            if lit:
                b=data[s]; s+=1
                ring[r]=b; r=(r+1)&(N-1); out.append(b)
            else:
                if s+1>=len(data): s=len(data); break
                i=data[s]; j=data[s+1]; s+=2
                i|=(j&0xf0)<<4; j=(j&0x0f)+TH
                for k in range(j+1):
                    b=ring[(i+k)&(N-1)]
                    ring[r]=b; r=(r+1)&(N-1); out.append(b)
    return bytes(out)
