uniform sampler2D uImage;
uniform int uDiagnostic;
uniform vec2 uDisplayResolution;
out vec4 outColor;
// Catmull-Rom upsampling from the traced resolution, in nine bilinear taps.
// Sharper than bilinear; negative lobes are clamped.
vec3 upsample(vec2 uv) {
  vec2 size=vec2(textureSize(uImage,0));
  vec2 position=uv*size-0.5,base=floor(position),f=position-base;
  vec2 w0=f*(-0.5+f*(1.0-0.5*f)),w1=1.0+f*f*(-2.5+1.5*f),w2=f*(0.5+f*(2.0-1.5*f)),w3=f*f*(-0.5+0.5*f);
  vec2 w12=w1+w2,offset=w2/w12;
  vec2 t0=(base-0.5)/size,t3=(base+2.5)/size,t12=(base+0.5+offset)/size;
  vec3 color=vec3(0.0);
  color+=(texture(uImage,vec2(t0.x,t0.y)).rgb*w0.x+texture(uImage,vec2(t12.x,t0.y)).rgb*w12.x+texture(uImage,vec2(t3.x,t0.y)).rgb*w3.x)*w0.y;
  color+=(texture(uImage,vec2(t0.x,t12.y)).rgb*w0.x+texture(uImage,vec2(t12.x,t12.y)).rgb*w12.x+texture(uImage,vec2(t3.x,t12.y)).rgb*w3.x)*w12.y;
  color+=(texture(uImage,vec2(t0.x,t3.y)).rgb*w0.x+texture(uImage,vec2(t12.x,t3.y)).rgb*w12.x+texture(uImage,vec2(t3.x,t3.y)).rgb*w3.x)*w3.y;
  return max(color,vec3(0.0));
}
void main() {
  vec3 color=upsample(gl_FragCoord.xy/uDisplayResolution);
  if (uDiagnostic==0) color=displayColor(color);
  outColor=vec4(encodeSRGB(color),1.0);
}
