// Categorias e dicionário de comércios brasileiros.
//
// `essential` marca o que entra no custo de vida mínimo — o que você não
// consegue cortar. `fixed` marca o que não muda de mês para mês.

export const CATEGORIES = [
  { id: 'moradia', name: 'Moradia', color: 'blue', essential: true, fixed: true },
  { id: 'contas', name: 'Contas da casa', color: 'blue', essential: true, fixed: true },
  { id: 'mercado', name: 'Mercado', color: 'jade', essential: true, fixed: false },
  { id: 'delivery', name: 'Delivery e restaurante', color: 'amber', essential: false, fixed: false },
  { id: 'transporte', name: 'Transporte', color: 'violet', essential: true, fixed: false },
  { id: 'combustivel', name: 'Combustível', color: 'violet', essential: true, fixed: false },
  { id: 'saude', name: 'Saúde', color: 'jade', essential: true, fixed: false },
  { id: 'farmacia', name: 'Farmácia', color: 'jade', essential: true, fixed: false },
  { id: 'assinaturas', name: 'Assinaturas', color: 'red', essential: false, fixed: true },
  { id: 'lazer', name: 'Lazer', color: 'amber', essential: false, fixed: false },
  { id: 'vestuario', name: 'Roupas', color: 'amber', essential: false, fixed: false },
  { id: 'educacao', name: 'Educação', color: 'blue', essential: false, fixed: true },
  { id: 'pet', name: 'Pet', color: 'jade', essential: true, fixed: false },
  { id: 'presentes', name: 'Presentes', color: 'amber', essential: false, fixed: false },
  { id: 'eletronicos', name: 'Eletrônicos', color: 'violet', essential: false, fixed: false },
  { id: 'viagem', name: 'Viagem', color: 'amber', essential: false, fixed: false },
  { id: 'taxas', name: 'Tarifas e juros', color: 'red', essential: false, fixed: false },
  { id: 'renda', name: 'Renda', color: 'jade', essential: false, fixed: false },
];

/**
 * Dicionário de comércios. Cobre o que aparece no extrato de qualquer
 * brasileiro — é o que dá 85% de acerto sem treinar modelo nenhum.
 */
export const MERCHANTS = [
  // mercado
  { match: 'PAO DE ACUCAR', label: 'Pão de Açúcar', categoryId: 'mercado' },
  { match: 'CARREFOUR', label: 'Carrefour', categoryId: 'mercado' },
  { match: 'ASSAI', label: 'Assaí', categoryId: 'mercado' },
  { match: 'ATACADAO', label: 'Atacadão', categoryId: 'mercado' },
  { match: 'EXTRA', label: 'Extra', categoryId: 'mercado' },
  { match: 'BIG', label: 'BIG', categoryId: 'mercado' },
  { match: 'ANGELONI', label: 'Angeloni', categoryId: 'mercado' },
  { match: 'ZAFFARI', label: 'Zaffari', categoryId: 'mercado' },
  { match: 'MERCADO', label: 'Supermercado', categoryId: 'mercado' },
  { match: 'SUPERMERC', label: 'Supermercado', categoryId: 'mercado' },
  { match: 'HORTIFRUTI', label: 'Hortifruti', categoryId: 'mercado' },
  { match: 'PADARIA', label: 'Padaria', categoryId: 'mercado' },

  // delivery
  { match: 'IFOOD', label: 'iFood', categoryId: 'delivery' },
  { match: 'RAPPI', label: 'Rappi', categoryId: 'delivery' },
  { match: 'UBER EATS', label: 'Uber Eats', categoryId: 'delivery' },
  { match: 'AIQFOME', label: 'Aiqfome', categoryId: 'delivery' },
  { match: 'BURGER KING', label: 'Burger King', categoryId: 'delivery' },
  { match: 'MCDONALD', label: "McDonald's", categoryId: 'delivery' },
  { match: 'SUBWAY', label: 'Subway', categoryId: 'delivery' },
  { match: 'HABIBS', label: "Habib's", categoryId: 'delivery' },
  { match: 'RESTAURANTE', label: 'Restaurante', categoryId: 'delivery' },
  { match: 'LANCHONETE', label: 'Lanchonete', categoryId: 'delivery' },
  { match: 'STARBUCKS', label: 'Starbucks', categoryId: 'delivery' },

  // transporte
  { match: 'UBER', label: 'Uber', categoryId: 'transporte' },
  { match: '99APP', label: '99', categoryId: 'transporte' },
  { match: '99 TAXI', label: '99', categoryId: 'transporte' },
  { match: 'CABIFY', label: 'Cabify', categoryId: 'transporte' },
  { match: 'ESTAPAR', label: 'Estacionamento', categoryId: 'transporte' },
  { match: 'ESTACIONAMENTO', label: 'Estacionamento', categoryId: 'transporte' },
  { match: 'SEM PARAR', label: 'Sem Parar', categoryId: 'transporte' },
  { match: 'CONECTCAR', label: 'ConectCar', categoryId: 'transporte' },
  { match: 'BILHETE UNICO', label: 'Transporte público', categoryId: 'transporte' },

  // combustível
  { match: 'POSTO', label: 'Posto', categoryId: 'combustivel' },
  { match: 'IPIRANGA', label: 'Ipiranga', categoryId: 'combustivel' },
  { match: 'SHELL', label: 'Shell', categoryId: 'combustivel' },
  { match: 'PETROBRAS', label: 'Petrobras', categoryId: 'combustivel' },
  { match: 'BR MANIA', label: 'BR Mania', categoryId: 'combustivel' },
  { match: 'AUTOPOSTO', label: 'Autoposto', categoryId: 'combustivel' },

  // assinaturas
  { match: 'NETFLIX', label: 'Netflix', categoryId: 'assinaturas' },
  { match: 'SPOTIFY', label: 'Spotify', categoryId: 'assinaturas' },
  { match: 'AMAZON PRIME', label: 'Amazon Prime', categoryId: 'assinaturas' },
  { match: 'DISNEY', label: 'Disney+', categoryId: 'assinaturas' },
  { match: 'HBO', label: 'HBO Max', categoryId: 'assinaturas' },
  { match: 'GLOBOPLAY', label: 'Globoplay', categoryId: 'assinaturas' },
  { match: 'YOUTUBE PREMIUM', label: 'YouTube Premium', categoryId: 'assinaturas' },
  { match: 'APPLE COM BILL', label: 'Apple', categoryId: 'assinaturas' },
  { match: 'GOOGLE', label: 'Google', categoryId: 'assinaturas' },
  { match: 'ICLOUD', label: 'iCloud', categoryId: 'assinaturas' },

  // saúde
  { match: 'DROGASIL', label: 'Drogasil', categoryId: 'farmacia' },
  { match: 'DROGA RAIA', label: 'Droga Raia', categoryId: 'farmacia' },
  { match: 'RAIA', label: 'Raia', categoryId: 'farmacia' },
  { match: 'PACHECO', label: 'Drogaria Pacheco', categoryId: 'farmacia' },
  { match: 'PAGUE MENOS', label: 'Pague Menos', categoryId: 'farmacia' },
  { match: 'FARMACIA', label: 'Farmácia', categoryId: 'farmacia' },
  { match: 'DROGARIA', label: 'Drogaria', categoryId: 'farmacia' },
  { match: 'UNIMED', label: 'Unimed', categoryId: 'saude' },
  { match: 'LABORATORIO', label: 'Laboratório', categoryId: 'saude' },
  { match: 'CLINICA', label: 'Clínica', categoryId: 'saude' },
  { match: 'ODONTO', label: 'Dentista', categoryId: 'saude' },

  // contas da casa
  { match: 'CLARO', label: 'Claro', categoryId: 'contas' },
  { match: 'VIVO', label: 'Vivo', categoryId: 'contas' },
  { match: 'TIM', label: 'TIM', categoryId: 'contas' },
  { match: 'OI ', label: 'Oi', categoryId: 'contas' },
  { match: 'ENEL', label: 'Enel', categoryId: 'contas' },
  { match: 'CEMIG', label: 'Cemig', categoryId: 'contas' },
  { match: 'COPEL', label: 'Copel', categoryId: 'contas' },
  { match: 'CELESC', label: 'Celesc', categoryId: 'contas' },
  { match: 'LIGHT', label: 'Light', categoryId: 'contas' },
  { match: 'SABESP', label: 'Sabesp', categoryId: 'contas' },
  { match: 'CASAN', label: 'Casan', categoryId: 'contas' },
  { match: 'COMGAS', label: 'Comgás', categoryId: 'contas' },
  { match: 'CONDOMINIO', label: 'Condomínio', categoryId: 'moradia' },
  { match: 'ALUGUEL', label: 'Aluguel', categoryId: 'moradia' },

  // lojas
  { match: 'MERCADOLIVRE', label: 'Mercado Livre', categoryId: 'eletronicos' },
  { match: 'MERCADO LIVRE', label: 'Mercado Livre', categoryId: 'eletronicos' },
  { match: 'AMAZON', label: 'Amazon', categoryId: 'eletronicos' },
  { match: 'MAGAZINE LUIZA', label: 'Magalu', categoryId: 'eletronicos' },
  { match: 'MAGALU', label: 'Magalu', categoryId: 'eletronicos' },
  { match: 'CASAS BAHIA', label: 'Casas Bahia', categoryId: 'eletronicos' },
  { match: 'RENNER', label: 'Renner', categoryId: 'vestuario' },
  { match: 'RIACHUELO', label: 'Riachuelo', categoryId: 'vestuario' },
  { match: 'CENTAURO', label: 'Centauro', categoryId: 'vestuario' },
  { match: 'NIKE', label: 'Nike', categoryId: 'vestuario' },

  // lazer
  { match: 'CINEMARK', label: 'Cinemark', categoryId: 'lazer' },
  { match: 'CINEPOLIS', label: 'Cinépolis', categoryId: 'lazer' },
  { match: 'SMART FIT', label: 'Smart Fit', categoryId: 'lazer' },
  { match: 'ACADEMIA', label: 'Academia', categoryId: 'lazer' },

  // pet
  { match: 'PETZ', label: 'Petz', categoryId: 'pet' },
  { match: 'COBASI', label: 'Cobasi', categoryId: 'pet' },
  { match: 'PETLOVE', label: 'Petlove', categoryId: 'pet' },
  { match: 'VETERINAR', label: 'Veterinário', categoryId: 'pet' },

  // viagem
  { match: 'GOL LINHAS', label: 'GOL', categoryId: 'viagem' },
  { match: 'LATAM', label: 'LATAM', categoryId: 'viagem' },
  { match: 'AZUL LINHAS', label: 'Azul', categoryId: 'viagem' },
  { match: 'BOOKING', label: 'Booking', categoryId: 'viagem' },
  { match: 'AIRBNB', label: 'Airbnb', categoryId: 'viagem' },

  // renda
  { match: 'SALARIO', label: 'Salário', categoryId: 'renda' },
  { match: 'PAGAMENTO SALARIO', label: 'Salário', categoryId: 'renda' },
  { match: 'REND PAGO', label: 'Rendimento', categoryId: 'renda' },

  // taxas
  { match: 'JUROS', label: 'Juros', categoryId: 'taxas' },
  { match: 'ENCARGOS', label: 'Encargos', categoryId: 'taxas' },
  { match: 'IOF', label: 'IOF', categoryId: 'taxas' },
  { match: 'TARIFA', label: 'Tarifa', categoryId: 'taxas' },
  { match: 'ANUIDADE', label: 'Anuidade', categoryId: 'taxas' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
