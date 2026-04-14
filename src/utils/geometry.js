export const getShapeRadius = (theta, type, radius, width, depth, cr) => {
   if (type === 'cylinder') return radius;
   let th = theta % (2 * Math.PI);
   if (th < 0) th += 2 * Math.PI;
   
   const vx = Math.abs(Math.sin(th));
   const vy = Math.abs(Math.cos(th));
   
   const cx = width / 2 - cr;
   const cy = depth / 2 - cr;
   
   if (vx === 0) return depth / 2;
   if (vy === 0) return width / 2;
   
   const r_right = (width / 2) / vx;
   if (r_right * vy <= cy) return r_right;
   
   const r_bottom = (depth / 2) / vy;
   if (r_bottom * vx <= cx) return r_bottom;
   
   const b = -2 * (vx * cx + vy * cy);
   const c = cx * cx + cy * cy - cr * cr;
   const disc = b * b - 4 * c;
   
   if (disc >= 0) {
      return (-b + Math.sqrt(disc)) / 2;
   }
   return radius;
};

export const getSubpixelValues = (img, x, y) => {
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  if (x0 < 0 || x1 >= img.width || y0 < 0 || y1 >= img.height) return { alpha: 0, bright: 255 };
  
  let dx = x - x0;
  let dy = y - y0;
  
  const getP = (px, py) => {
     let i = (py * img.width + px) * 4;
     let a = img.data[i+3];
     let b = (img.data[i] + img.data[i+1] + img.data[i+2]) / 3;
     return { a, b };
  };

  let p00 = getP(x0, y0), p10 = getP(x1, y0);
  let p01 = getP(x0, y1), p11 = getP(x1, y1);
  
  let aTop = p00.a * (1 - dx) + p10.a * dx;
  let aBot = p01.a * (1 - dx) + p11.a * dx;
  let alpha = aTop * (1 - dy) + aBot * dy;

  let bTop = p00.b * (1 - dx) + p10.b * dx;
  let bBot = p01.b * (1 - dx) + p11.b * dx;
  let bright = bTop * (1 - dy) + bBot * dy;

  return { alpha, bright };
};
