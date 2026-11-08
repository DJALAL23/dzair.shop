export interface Wilaya {
  id: number;
  name: string;
  nameAr: string;
}

export interface Commune {
  id: string;
  wilayaId: number;
  name: string;
  nameAr: string;
}
